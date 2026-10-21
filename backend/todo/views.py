import json
import logging
from typing import Generator
import os
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from django.db import connection
from django.shortcuts import render, redirect, get_object_or_404
from django.http import JsonResponse, StreamingHttpResponse
from .models import Conversation, ChatMessage

logger = logging.getLogger(__name__)

MAX_HISTORY_TURNS = 12

def provider_config():
    """Read an OpenAI-compatible provider at request time; no vendor SDK is required."""
    return {
        'base_url': os.getenv('AI_BASE_URL', 'https://api.openai.com/v1').rstrip('/'),
        'api_key': os.getenv('AI_API_KEY', ''),
        'model': os.getenv('AI_MODEL', 'gpt-4o-mini'),
    }

def generate_reply(messages):
    config = provider_config()
    if not config['api_key']:
        return ('AI provider is not configured. Set AI_API_KEY, AI_BASE_URL, and AI_MODEL in your environment, '
                'then restart the backend.')
    payload = json.dumps({'model': config['model'], 'messages': messages, 'temperature': 0.2}).encode()
    request = Request(f"{config['base_url']}/chat/completions", data=payload, method='POST', headers={
        'Authorization': f"Bearer {config['api_key']}", 'Content-Type': 'application/json'})
    try:
        with urlopen(request, timeout=90) as response:
            result = json.loads(response.read().decode('utf-8'))
        return result['choices'][0]['message']['content']
    except (HTTPError, URLError, KeyError, IndexError, json.JSONDecodeError) as error:
        logger.exception('AI provider request failed')
        return f'AI provider request failed: {error}. Check AI_BASE_URL, AI_API_KEY, and AI_MODEL.'

def build_messages_payload(history_messages) -> list:
    """Construct a bounded, provider-neutral chat payload."""
    messages = [{
        'role': 'system',
        'content': (
            'You are Jarvis AI, a highly intelligent, fast, and helpful AI assistant. '
            'Answer clearly and accurately. Use Markdown for formatting and code blocks.'
        )
    }]
    # Bound to recent messages to avoid context bloat & slow LLM generation
    bounded_history = history_messages[-MAX_HISTORY_TURNS:] if len(history_messages) > MAX_HISTORY_TURNS else history_messages
    for msg in bounded_history:
        role = 'user' if msg.sender == 'user' else 'assistant'
        messages.append({'role': role, 'content': msg.content})
    return messages

def index(request, conversation_id=None):
    conversations = Conversation.objects.all()
    active_conversation = None
    chat_messages = []

    if conversation_id:
        active_conversation = get_object_or_404(Conversation, id=conversation_id)
        chat_messages = active_conversation.messages.all()

    return render(request, 'todo/index.html', {
        'conversations': conversations,
        'active_conversation': active_conversation,
        'chat_messages': chat_messages,
        'model_name': provider_config()['model'],
    })

def health_api(request):
    """Small operational probe used by monitors and the command center."""
    database = 'ok'
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1')
    except Exception:
        database = 'error'
    return JsonResponse({
        'status': 'ok' if database == 'ok' else 'degraded',
        'service': 'jarvis-api',
        'database': database,
        'provider': provider_config()['base_url'],
        'model': provider_config()['model'],
        'ai_configured': bool(provider_config()['api_key']),
        'conversations': Conversation.objects.count(),
        'messages': ChatMessage.objects.count(),
    }, status=200 if database == 'ok' else 503)

def export_conversation(request, conversation_id):
    """Export a conversation as JSON for debugging, handoff, or archival."""
    conversation = get_object_or_404(Conversation, id=conversation_id)
    payload = {
        'id': str(conversation.id), 'title': conversation.title,
        'created_at': conversation.created_at.isoformat(),
        'updated_at': conversation.updated_at.isoformat(),
        'messages': [
            {'id': str(message.id), 'sender': message.sender, 'content': message.content,
             'created_at': message.created_at.isoformat()}
            for message in conversation.messages.all()
        ],
    }
    response = JsonResponse(payload, json_dumps_params={'indent': 2})
    response['Content-Disposition'] = f'attachment; filename="jarvis-{conversation.id}.json"'
    return response

def new_chat(request):
    return redirect('index')

def delete_chat(request, conversation_id):
    conversation = get_object_or_404(Conversation, id=conversation_id)
    conversation.delete()
    return redirect('index')

def chat_api(request):
    """High-performance streaming and standard chat endpoint."""
    if request.method != "POST":
        return JsonResponse({"error": "Only POST allowed"}, status=405)

    try:
        data = json.loads(request.body) if request.body else request.POST
        prompt = data.get("message", "").strip()
        conversation_id = data.get("conversation_id")
        stream_requested = data.get("stream", True)

        if not prompt:
            return JsonResponse({"error": "Message content is required"}, status=400)

        # Get or create conversation
        if conversation_id:
            conversation = get_object_or_404(Conversation, id=conversation_id)
        else:
            title = prompt[:35] + ("..." if len(prompt) > 35 else "")
            conversation = Conversation.objects.create(title=title)

        # Save user message
        user_msg = ChatMessage.objects.create(
            conversation=conversation,
            sender='user',
            content=prompt
        )

        # Retrieve recent history efficiently
        history = list(conversation.messages.order_by('created_at'))
        messages_payload = build_messages_payload(history)
        reply = generate_reply(messages_payload)

        if stream_requested:
            def stream_generator() -> Generator[str, None, None]:
                full_reply = []
                # First event sends metadata
                yield f"data: {json.dumps({'type': 'init', 'conversation_id': str(conversation.id), 'conversation_title': conversation.title, 'user_time': user_msg.created_at.strftime('%H:%M')})}\n\n"
                
                try:
                    full_reply.append(reply)
                    yield f"data: {json.dumps({'type': 'chunk', 'delta': reply})}\n\n"
                    
                    complete_text = "".join(full_reply)
                    ai_msg = ChatMessage.objects.create(
                        conversation=conversation,
                        sender='ai',
                        content=complete_text
                    )

                    yield f"data: {json.dumps({'type': 'done', 'ai_time': ai_msg.created_at.strftime('%H:%M')})}\n\n"
                except Exception as stream_err:
                    logger.error(f"Streaming error: {stream_err}")
                    yield f"data: {json.dumps({'type': 'error', 'error': str(stream_err)})}\n\n"

            response = StreamingHttpResponse(stream_generator(), content_type='text/event-stream')
            response['Cache-Control'] = 'no-cache, no-transform'
            response['X-Accel-Buffering'] = 'no'
            return response

        # Non-streaming fallback
        content = reply
        
        ai_msg = ChatMessage.objects.create(
            conversation=conversation,
            sender='ai',
            content=content
        )

        return JsonResponse({
            "status": "success",
            "conversation_id": str(conversation.id),
            "conversation_title": conversation.title,
            "user_message": {
                "id": str(user_msg.id),
                "content": user_msg.content,
                "created_at": user_msg.created_at.strftime("%H:%M")
            },
            "ai_message": {
                "id": str(ai_msg.id),
                "content": ai_msg.content,
                "created_at": ai_msg.created_at.strftime("%H:%M")
            }
        })
    except Exception as e:
        logger.error(f"Error in chat_api: {e}")
        return JsonResponse({"error": str(e)}, status=500)

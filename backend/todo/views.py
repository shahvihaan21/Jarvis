import json
import logging
from typing import Generator
import os
import re
from datetime import datetime
from urllib.parse import quote_plus
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from django.db import connection
from django.utils import timezone
from datetime import timedelta
from django.shortcuts import render, redirect, get_object_or_404
from django.http import JsonResponse, StreamingHttpResponse
from .models import Conversation, ChatMessage, TodoItem, Note, Reminder, Memory

logger = logging.getLogger(__name__)

MAX_HISTORY_TURNS = 12

def local_command(prompt):
    """Handle simple Level 1 commands without requiring an AI provider."""
    text = prompt.lower().strip()
    now = datetime.now()

    if re.fullmatch(r'(help|commands|what can you do|capabilities)\s*[?.!]*', text):
        return ("### Level 1 capabilities\n\n"
                "- Time and date\n- Jokes and greetings\n- Web and Wikipedia search\n"
                "- YouTube and music lookup\n- Open supported websites\n\n"
                "Try: `what time is it`, `search for Python`, or `play jazz music`.")
    if re.search(r'\b(hello|hi|hey|good morning|good evening)\b', text):
        return f"Hello. JARVIS is ready. It is **{now.strftime('%I:%M %p')}**. How can I help?"
    if re.search(r'\b(thank you|thanks)\b', text):
        return "Always happy to help."

    if re.search(r'\b(time|what time is it|current time)\b', text):
        return f"The current time is **{now.strftime('%I:%M %p')}**."
    if re.search(r'\b(date|what day is it|today)\b', text):
        return f"Today is **{now.strftime('%A, %B %d, %Y')}**."
    if re.search(r'\b(joke|make me laugh|funny)\b', text):
        return "Why did the computer get cold? Because it left its Windows open."

    wiki_match = re.search(r'(?:who is|what is|tell me about|wikipedia)\s+(.+)', prompt, re.I)
    if wiki_match:
        topic = wiki_match.group(1).strip(' ?.')
        return (f"[Search Wikipedia for **{topic}**](https://en.wikipedia.org/w/index.php?search={quote_plus(topic)})\n\n"
                f"I found a focused reference for {topic}. Open it to read the latest summary.")

    search_match = re.search(r'(?:search(?: the web)? for|look up|google)\s+(.+)', prompt, re.I)
    if search_match:
        query = search_match.group(1).strip(' ?.')
        return f"[Search the web for **{query}**](https://www.google.com/search?q={quote_plus(query)})"

    youtube_match = re.search(r'(?:play|youtube|watch)\s+(.+)', prompt, re.I)
    if youtube_match:
        query = youtube_match.group(1).strip(' ?.')
        return f"[Open **{query}** on YouTube](https://www.youtube.com/results?search_query={quote_plus(query)})"

    site_match = re.search(r'open\s+(https?://\S+|[\w.-]+\.[a-z]{2,})', prompt, re.I)
    if site_match:
        url = site_match.group(1)
        if not url.startswith('http'):
            url = f'https://{url}'
        return f"[Open {url}](<{url}>)"

    shortcuts = {
        'google': 'https://www.google.com',
        'youtube': 'https://www.youtube.com',
        'gmail': 'https://mail.google.com',
        'github': 'https://github.com',
        ' wikipedia': 'https://www.wikipedia.org',
    }
    for name, url in shortcuts.items():
        if re.search(rf'\bopen\s+{re.escape(name.strip())}\b', text):
            return f"[Open {name.strip().title()}]({url})"

    if re.search(r'\b(open|launch)\b', text) and re.search(r'\b(app|application|file|folder)\b', text):
        return ("I can open websites from this browser. Desktop apps and local files need a local companion service "
                "with explicit permissions; I will keep that capability disabled until it is configured safely.")

    if re.search(r'\b(music|songs|playlist)\b', text):
        return "[Open YouTube Music](https://music.youtube.com/) or ask me to play a specific song."
    return None


def execute_productivity_command(prompt):
    """Persist simple personal-assistant actions and return a user-facing result."""
    text = prompt.strip()
    todo_match = re.match(r'(?:add|remember)\s+(.+?)\s+to\s+(?:my\s+)?(?:todo|to-do|list)$', text, re.I)
    if todo_match:
        item = TodoItem.objects.create(title=todo_match.group(1).strip())
        return f"Added **{item.title}** to your to-do list."
    note_match = re.match(r'(?:take|save)\s+(?:a\s+)?note(?:\s+that)?\s*[:\-]?\s*(.+)$', text, re.I)
    if note_match:
        note = Note.objects.create(content=note_match.group(1).strip())
        return f"Saved your note: **{note.content}**"
    reminder_match = re.match(r'remind me in\s+(\d+)\s+(minute|minutes|hour|hours)\s+to\s+(.+)$', text, re.I)
    if reminder_match:
        amount, unit, title = reminder_match.groups()
        seconds = int(amount) * (3600 if unit.lower().startswith('hour') else 60)
        reminder = Reminder.objects.create(title=title.strip(), due_at=timezone.now() + timedelta(seconds=seconds))
        return f"Reminder set for **{reminder.due_at.strftime('%H:%M')}**: {reminder.title}"
    return None


def execute_memory_command(prompt):
    """Store or recall a small user fact for later conversations."""
    remember = re.match(r'(?:my\s+)?(name|favorite|favourite|preference)\s+is\s+(.+)$', prompt.strip(), re.I)
    if remember:
        key, value = remember.groups()
        memory, _ = Memory.objects.update_or_create(key=key.lower(), defaults={'value': value.strip()})
        return f"I’ll remember that your {memory.key} is **{memory.value}**."
    if re.fullmatch(r'(what do you remember|show my memories|my memories)', prompt.strip(), re.I):
        memories = list(Memory.objects.values_list('key', 'value'))
        return '\n'.join(f'- {key}: {value}' for key, value in memories) if memories else 'I do not have any saved memories yet.'
    return None

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
    memories = Memory.objects.values('key', 'value')[:20]
    if memories:
        messages[0]['content'] += '\nKnown user preferences:\n' + '\n'.join(f"- {item['key']}: {item['value']}" for item in memories)
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


def productivity_api(request):
    """Read-only dashboard data for tasks, notes, and pending reminders."""
    if request.method != 'GET':
        return JsonResponse({'error': 'Only GET allowed'}, status=405)
    return JsonResponse({
        'todos': list(TodoItem.objects.values('id', 'title', 'completed', 'created_at')),
        'notes': list(Note.objects.values('id', 'title', 'content', 'updated_at')[:20]),
        'reminders': list(Reminder.objects.filter(fired=False).values('id', 'title', 'due_at')[:20]),
        'memories': list(Memory.objects.values('id', 'key', 'value', 'updated_at')[:20]),
    }, default=str)

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
        reply = execute_productivity_command(prompt) or execute_memory_command(prompt) or local_command(prompt) or generate_reply(messages_payload)

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

import json
from unittest.mock import patch

from django.test import Client, TestCase

from .models import ChatMessage, Conversation


class ChatApiTests(TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True)

    def test_chat_api_rejects_cross_site_post_without_csrf_token(self):
        response = self.client.post(
            "/api/chat/",
            data=json.dumps({"message": "Hello Jarvis"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(Conversation.objects.count(), 0)

    def test_chat_api_accepts_valid_csrf_token(self):
        page = self.client.get("/")
        csrf_token = page.cookies["csrftoken"].value

        with patch("todo.views.ollama.chat", return_value={
            "message": {"content": "Hello, commander."}
        }):
            response = self.client.post(
                "/api/chat/",
                data=json.dumps({"message": "Hello Jarvis", "stream": False}),
                content_type="application/json",
                HTTP_X_CSRFTOKEN=csrf_token,
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(ChatMessage.objects.count(), 2)
        self.assertEqual(response.json()["ai_message"]["content"], "Hello, commander.")

# Create your tests here.

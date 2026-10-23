import json
from unittest.mock import patch

from django.test import Client, TestCase

from .models import ChatMessage, Conversation
from .views import local_command


class LocalCommandTests(TestCase):
    def test_time_command_does_not_become_wikipedia_query(self):
        self.assertIn("current time is", local_command("what time is it").lower())

    def test_date_command(self):
        self.assertIn("today is", local_command("what is today's date").lower())

    def test_help_command(self):
        self.assertIn("capabilities", local_command("help").lower())

    def test_search_links_are_encoded(self):
        self.assertIn("google.com/search?q=iron+man", local_command("search for iron man").lower())

    def test_youtube_command(self):
        self.assertIn("youtube.com/results", local_command("play jazz").lower())

    def test_productivity_commands_are_persisted(self):
        from .views import execute_productivity_command
        self.assertIn("Added", execute_productivity_command("add milk to my list"))
        self.assertIn("Reminder set", execute_productivity_command("remind me in 10 minutes to drink water"))


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

        with patch("todo.views.generate_reply", return_value="Hello, commander."):
            response = self.client.post(
                "/api/chat/",
                data=json.dumps({"message": "Explain quantum computing", "stream": False}),
                content_type="application/json",
                HTTP_X_CSRFTOKEN=csrf_token,
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(ChatMessage.objects.count(), 2)
        self.assertEqual(response.json()["ai_message"]["content"], "Hello, commander.")

# Create your tests here.

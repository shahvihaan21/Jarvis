// Markdown rendering & code highlighting helper
function renderMarkdown(rawText) {
    if (!rawText) return '';
    const parsedHtml = marked.parse(rawText);
    const tempContainer = document.createElement('div');
    tempContainer.innerHTML = parsedHtml;

    // Apply Highlight.js syntax highlighting to code blocks
    tempContainer.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block);
    });

    addCopyButtons(tempContainer);
    return tempContainer.innerHTML;
}

function scrollToBottom() {
    const container = document.getElementById('messagesContainer');
    if (container) {
        container.scrollTop = container.scrollHeight;
    }
}

function checkEnter(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const chatForm = document.getElementById('chatForm');
        if (chatForm && typeof chatForm.requestSubmit === 'function') {
            chatForm.requestSubmit();
        } else {
            handleSend(e);
        }
    }
}

function sendStarterPrompt(text) {
    const input = document.getElementById('promptInput');
    if (!input) return;
    input.value = text;
    const chatForm = document.getElementById('chatForm');
    if (chatForm && typeof chatForm.requestSubmit === 'function') {
        chatForm.requestSubmit();
    } else {
        handleSend(new Event('submit'));
    }
}

function addCopyButtons(container) {
    container.querySelectorAll('pre').forEach(pre => {
        if (pre.querySelector('.copy-btn')) return;
        const btn = document.createElement('button');
        btn.className = 'copy-btn';
        btn.type = 'button';
        btn.innerHTML = '<i class="fa-regular fa-copy"></i> Copy';
        btn.onclick = (e) => {
            e.preventDefault();
            const code = pre.querySelector('code') ? pre.querySelector('code').innerText : pre.innerText;
            navigator.clipboard.writeText(code);
            btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
            setTimeout(() => { btn.innerHTML = '<i class="fa-regular fa-copy"></i> Copy'; }, 2000);
        };
        pre.appendChild(btn);
    });
}

function escapeHtml(text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

let speechRecognition = null;
let isListening = false;
let speakReplies = true;

function setupVoiceControls() {
    const panel = document.querySelector('.chat-panel');
    const messages = document.getElementById('messagesContainer');
    if (!panel || !messages) return;
    const toolbar = document.createElement('div');
    toolbar.className = 'voice-toolbar';
    toolbar.innerHTML = '<button class="voice-toggle" id="voiceToggle" type="button" aria-pressed="false">🎙 <span>Voice</span></button>' +
        '<button class="voice-toggle active" id="speakToggle" type="button" aria-pressed="true">🔊 <span>Speak</span></button>' +
        '<span class="voice-status" id="voiceStatus" role="status" aria-live="polite">Voice input is ready when you are.</span>';
    panel.querySelector('.panel-head').appendChild(toolbar);

    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const voiceButton = document.getElementById('voiceToggle');
    const speakButton = document.getElementById('speakToggle');
    if (!Recognition) {
        voiceButton.disabled = true;
        setVoiceStatus('Voice input is not supported in this browser. Try Chrome or Edge.');
        return;
    }
    speechRecognition = new Recognition();
    speechRecognition.continuous = true;
    speechRecognition.interimResults = true;
    speechRecognition.lang = document.documentElement.lang || 'en-US';
    speechRecognition.onresult = (event) => {
        const input = document.getElementById('promptInput');
        let finalText = '';
        let interimText = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const text = event.results[i][0].transcript;
            if (event.results[i].isFinal) finalText += text;
            else interimText += text;
        }
        if (input && finalText) input.value = `${input.value} ${finalText}`.trim();
        setVoiceStatus(interimText ? `Listening: ${interimText}` : 'Listening…');
    };
    speechRecognition.onerror = (event) => {
        if (event.error !== 'aborted') setVoiceStatus(`Voice error: ${event.error}`);
        stopListening();
    };
    speechRecognition.onend = () => { if (isListening) speechRecognition.start(); };
    voiceButton.onclick = () => isListening ? stopListening() : startListening();
    speakButton.onclick = () => {
        speakReplies = !speakReplies;
        speakButton.classList.toggle('active', speakReplies);
        speakButton.setAttribute('aria-pressed', String(speakReplies));
        if (!speakReplies) window.speechSynthesis?.cancel();
    };
}

function setVoiceStatus(message) {
    const status = document.getElementById('voiceStatus');
    if (status) status.textContent = message;
}

function startListening() {
    if (!speechRecognition) return;
    isListening = true;
    const button = document.getElementById('voiceToggle');
    button.classList.add('active');
    button.setAttribute('aria-pressed', 'true');
    setVoiceStatus('Listening… speak your command.');
    speechRecognition.start();
}

function stopListening() {
    isListening = false;
    const button = document.getElementById('voiceToggle');
    if (button) { button.classList.remove('active'); button.setAttribute('aria-pressed', 'false'); }
    setVoiceStatus('Voice input is ready when you are.');
    speechRecognition?.stop();
}

function speakReply(text) {
    if (!speakReplies || !window.speechSynthesis || !text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.replace(/[*_`#>\[\]]/g, ''));
    utterance.rate = 1.02;
    window.speechSynthesis.speak(utterance);
}

async function handleSend(e) {
    if (e) e.preventDefault();
    const input = document.getElementById('promptInput');
    const sendBtn = document.getElementById('sendBtn');
    if (!input) return;

    const prompt = input.value.trim();
    if (!prompt) return;

    const conversationIdInput = document.getElementById('conversationId');
    const container = document.getElementById('messagesContainer');
    const csrfEl = document.querySelector('[name=csrfmiddlewaretoken]');
    const csrfToken = csrfEl ? csrfEl.value : '';

    // Disable controls during request processing
    input.disabled = true;
    if (sendBtn) sendBtn.disabled = true;

    // Hide hero state if present
    const hero = container ? container.querySelector('.hero-state') : null;
    if (hero) hero.remove();

    // Append User Message Bubble
    const userWrapper = document.createElement('div');
    userWrapper.className = 'msg-wrapper user';
    userWrapper.innerHTML = `
        <div class="avatar"><i class="fa-solid fa-user"></i></div>
        <div class="msg-bubble">
            <div class="msg-content">${renderMarkdown(prompt)}</div>
            <div class="text-end text-secondary fs-7 mt-2" style="font-size: 0.72rem; color: #6ee7b7 !important;">Now</div>
        </div>
    `;
    if (container) container.appendChild(userWrapper);

    // Append AI Typing Placeholder Bubble
    const aiWrapper = document.createElement('div');
    aiWrapper.className = 'msg-wrapper ai';
    aiWrapper.id = 'aiTypingBubble';
    aiWrapper.innerHTML = `
        <div class="avatar"><i class="fa-solid fa-brain"></i></div>
        <div class="msg-bubble">
            <div class="msg-content">
                <div class="typing-indicator">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
            </div>
            <div class="ai-time-label text-end text-secondary fs-7 mt-2" style="font-size: 0.72rem; color: #6ee7b7 !important; display: none;"></div>
        </div>
    `;
    if (container) container.appendChild(aiWrapper);
    scrollToBottom();

    // Reset input
    input.value = '';

    try {
        const response = await fetch('/api/chat/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken
            },
            body: JSON.stringify({
                message: prompt,
                conversation_id: conversationIdInput ? (conversationIdInput.value || null) : null,
                stream: true
            })
        });

        if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
        }

        const contentType = response.headers.get('content-type') || '';
        const msgContentEl = aiWrapper.querySelector('.msg-content');
        const timeLabel = aiWrapper.querySelector('.ai-time-label');

        if (contentType.includes('text/event-stream')) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let accumulatedText = '';
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const eventData = JSON.parse(line.substring(6));
                            if (eventData.type === 'init') {
                                if (conversationIdInput && !conversationIdInput.value && eventData.conversation_id) {
                                    conversationIdInput.value = eventData.conversation_id;
                                    window.history.pushState({}, '', `/c/${eventData.conversation_id}/`);
                                }
                            } else if (eventData.type === 'chunk') {
                                accumulatedText += eventData.delta;
                                if (msgContentEl) {
                                    msgContentEl.innerHTML = renderMarkdown(accumulatedText);
                                }
                                scrollToBottom();
                            } else if (eventData.type === 'done') {
                                speakReply(accumulatedText);
                                if (eventData.ai_time && timeLabel) {
                                    timeLabel.innerText = eventData.ai_time;
                                    timeLabel.style.display = 'block';
                                }
                            } else if (eventData.type === 'error') {
                                if (msgContentEl) {
                                    msgContentEl.innerHTML = `<div class="text-danger p-2">Error: ${escapeHtml(eventData.error)}</div>`;
                                }
                            }
                        } catch (e) {
                            console.error("Event parse error", e);
                        }
                    }
                }
            }
        } else {
            const data = await response.json();
            if (data.status === 'success') {
                if (conversationIdInput && !conversationIdInput.value) {
                    conversationIdInput.value = data.conversation_id;
                    window.history.pushState({}, '', `/c/${data.conversation_id}/`);
                }
                if (msgContentEl) {
                    msgContentEl.innerHTML = renderMarkdown(data.ai_message.content);
                }
                if (timeLabel) {
                    timeLabel.innerText = data.ai_message.created_at;
                    timeLabel.style.display = 'block';
                }
                speakReply(data.ai_message.content);
            } else {
                if (msgContentEl) {
                    msgContentEl.innerHTML = `<div class="text-danger p-2">Error: ${escapeHtml(data.error || 'Failed to generate response.')}</div>`;
                }
            }
        }
    } catch (err) {
        console.error(err);
        const bubble = aiWrapper.querySelector('.msg-bubble');
        if (bubble) {
            bubble.innerHTML = `<div class="text-danger p-2">Network error connecting to Jarvis AI server.</div>`;
        }
    } finally {
        input.disabled = false;
        if (sendBtn) sendBtn.disabled = false;
        input.focus();
    }

    scrollToBottom();
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    // Initial render of existing message bubbles from backend
    document.querySelectorAll('.msg-content').forEach(el => {
        const rawEl = el.querySelector('.raw-content');
        if (rawEl) {
            const raw = rawEl.innerHTML || rawEl.textContent;
            el.innerHTML = renderMarkdown(raw);
        }
    });

    scrollToBottom();
    setupVoiceControls();
    refreshRuntimeStatus();
});

async function refreshRuntimeStatus() {
    try {
        const response = await fetch('/api/health/');
        const data = await response.json();
        const status = document.querySelector('.live');
        const footerStatus = document.querySelector('.sidebar-footer b');
        const runtimePill = document.querySelector('.core-panel .pill');
        const healthy = response.ok && data.status === 'ok';
        document.body.classList.toggle('runtime-degraded', !healthy);
        if (status) {
            status.innerHTML = healthy
                ? (data.ai_configured ? '<i></i> SYSTEM ONLINE' : '<i></i> AI SETUP REQUIRED')
                : '<i></i> SYSTEM DEGRADED';
        }
        if (footerStatus) footerStatus.textContent = healthy ? 'READY' : 'CHECK';
        if (runtimePill) {
            runtimePill.classList.toggle('green', healthy);
            runtimePill.textContent = healthy ? '● OPERATIONAL' : '● DEGRADED';
        }
    } catch (error) {
        const status = document.querySelector('.live');
        if (status) status.innerHTML = '<i></i> DEGRADED';
        document.body.classList.add('runtime-degraded');
    }
}

// Keep the command center synchronized with the backend while it is open.
setInterval(refreshRuntimeStatus, 10000);

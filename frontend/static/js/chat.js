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
let commandPalette = null;
let previousRuntimeState = null;
let audioEnabled = false;
let audioContext = null;

function playJarvisTone(type = 'tick') {
    if (!audioEnabled) return;
    const AudioEngine = window.AudioContext || window.webkitAudioContext;
    if (!AudioEngine) return;
    audioContext ||= new AudioEngine();
    if (audioContext.state === 'suspended') audioContext.resume();
    const patterns = { tick: [[520, 0, .1]], confirm: [[660, 0, .12], [990, .08, .2]], warning: [[240, 0, .18], [170, .1, .26]], boot: [[330, 0, .16], [520, .12, .18], [780, .25, .3]] };
    const pattern = patterns[type] || patterns.tick;
    pattern.forEach(([frequency, offset, duration]) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const filter = audioContext.createBiquadFilter();
        const start = audioContext.currentTime + offset;
        oscillator.frequency.setValueAtTime(frequency, start);
        oscillator.frequency.exponentialRampToValueAtTime(frequency * (type === 'warning' ? .72 : 1.04), start + duration);
        oscillator.type = type === 'warning' ? 'sawtooth' : 'sine';
        filter.type = 'lowpass';
        filter.frequency.value = type === 'warning' ? 900 : 2200;
        gain.gain.setValueAtTime(.0001, start);
        gain.gain.exponentialRampToValueAtTime(type === 'warning' ? .025 : .045, start + .012);
        gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
        oscillator.connect(filter).connect(gain).connect(audioContext.destination);
        oscillator.start(start);
        oscillator.stop(start + duration + .03);
    });
    document.body.classList.add('sound-playing');
    window.setTimeout(() => document.body.classList.remove('sound-playing'), 420);
}

function setupAudioControl() {
    const host = document.querySelector('.top-status');
    if (!host || document.getElementById('audioToggle')) return;
    const button = document.createElement('button');
    button.id = 'audioToggle';
    button.className = 'audio-toggle';
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    button.textContent = '◌ AUDIO OFF';
    button.title = 'Enable Jarvis interface sound';
    const unlock = () => {
        if (!audioEnabled) {
            audioEnabled = true;
            button.textContent = '◉ AUDIO ON';
            button.classList.add('enabled');
            document.body.classList.add('audio-active');
            button.setAttribute('aria-pressed', 'true');
            playJarvisTone('boot');
        }
        document.removeEventListener('pointerdown', unlock, true);
        document.removeEventListener('keydown', unlock, true);
    };
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
    button.onclick = () => {
        audioEnabled = !audioEnabled;
        if (audioEnabled) {
            const AudioEngine = window.AudioContext || window.webkitAudioContext;
            if (AudioEngine) audioContext ||= new AudioEngine();
            audioContext?.resume();
            button.textContent = '◉ AUDIO ON';
            button.classList.add('enabled');
            document.body.classList.add('audio-active');
            button.setAttribute('aria-pressed', 'true');
            playJarvisTone('confirm');
        } else {
            button.textContent = '◌ AUDIO OFF';
            button.classList.remove('enabled');
            document.body.classList.remove('audio-active');
            button.setAttribute('aria-pressed', 'false');
        }
    };
    host.insertBefore(button, host.firstChild);
}

function showJarvisToast(message, tone = 'info') {
    let toast = document.getElementById('jarvisToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'jarvisToast';
        toast.className = 'jarvis-toast';
        document.body.appendChild(toast);
    }
    toast.className = `jarvis-toast ${tone}`;
    toast.innerHTML = `<i></i><span>${escapeHtml(message)}</span>`;
    requestAnimationFrame(() => toast.classList.add('visible'));
    window.clearTimeout(toast.hideTimer);
    toast.hideTimer = window.setTimeout(() => toast.classList.remove('visible'), 3600);
}

function setupProductivityFeatures() {
    setupAudioControl();
    const coreVisual = document.querySelector('.core-visual');
    if (coreVisual && !coreVisual.querySelector('.holo-avatar')) {
        const hologram = document.createElement('div');
        hologram.className = 'holo-avatar';
        hologram.setAttribute('aria-hidden', 'true');
        hologram.innerHTML = '<span class="avatar-head"></span><span class="avatar-body"></span><i class="avatar-beam"></i><b class="holo-label label-top">NEURAL LINK <em>ACTIVE</em></b><b class="holo-label label-left">CORE LOAD <em>42%</em></b><b class="holo-label label-right">THREAT LEVEL <em>LOW</em></b>';
        coreVisual.prepend(hologram);
    }
    const input = document.getElementById('promptInput');
    if (input) input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
    });
    commandPalette = document.createElement('div');
    commandPalette.className = 'command-palette hidden';
    commandPalette.innerHTML = `<div class="command-card" role="dialog" aria-modal="true" aria-label="Jarvis command palette"><div class="command-search"><span>⌘</span><input id="commandSearch" placeholder="Search Jarvis actions..." autocomplete="off"></div><div class="command-items"><button data-command="focus">◉ <span>Focus workspace</span><kbd>F</kbd></button><button data-command="voice">🎙 <span>Toggle voice input</span><kbd>V</kbd></button><button data-command="new">＋ <span>Start new session</span><kbd>N</kbd></button><button data-command="top">↑ <span>Scroll to latest</span><kbd>↵</kbd></button></div><small>Press Esc to close</small></div>`;
    document.body.appendChild(commandPalette);
    commandPalette.addEventListener('click', (event) => {
        const action = event.target.closest('[data-command]')?.dataset.command;
        if (action) { playJarvisTone('tick'); runCommand(action); }
        if (event.target === commandPalette) closeCommandPalette();
    });
    document.getElementById('commandSearch').addEventListener('input', (event) => {
        const query = event.target.value.toLowerCase();
        document.querySelectorAll('.command-items button').forEach(button => { button.hidden = !button.textContent.toLowerCase().includes(query); });
    });
    document.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); toggleCommandPalette(); }
        if (event.key === 'Escape' && commandPalette && !commandPalette.classList.contains('hidden')) closeCommandPalette();
        if (event.key.toLowerCase() === 'f' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) runCommand('focus');
    });
    document.querySelectorAll('button').forEach(button => button.addEventListener('click', () => playJarvisTone('tick')));
}
function toggleCommandPalette() { commandPalette?.classList.toggle('hidden'); if (commandPalette && !commandPalette.classList.contains('hidden')) document.getElementById('commandSearch').focus(); }
function closeCommandPalette() { commandPalette?.classList.add('hidden'); }
function runCommand(action) { closeCommandPalette(); if (action === 'focus') document.body.classList.toggle('focus-mode'); if (action === 'voice') document.getElementById('voiceToggle')?.click(); if (action === 'new') window.location.href = '/'; if (action === 'top') scrollToBottom(); }

function startBootSequence() {
    const screen = document.getElementById('bootScreen');
    const progress = document.getElementById('bootProgress');
    const log = document.getElementById('bootLog');
    const skip = document.getElementById('bootSkip');
    if (!screen) return;
    const steps = ['CALIBRATING REACTOR...', 'CONNECTING MEMORY INDEX...', 'VERIFYING AI GATEWAY...', 'COMMAND CENTER READY'];
    let step = 0;
    let finished = false;
    const finish = () => {
        if (finished) return;
        finished = true;
        screen.classList.add('complete');
        window.setTimeout(() => screen.remove(), 800);
    };
    skip.onclick = finish;
    const timer = window.setInterval(() => {
        step += 1;
        playJarvisTone(step >= steps.length ? 'confirm' : 'boot');
        if (progress) progress.style.width = `${Math.min(step, steps.length) * 25}%`;
        if (log) log.textContent = steps[Math.min(step, steps.length) - 1];
        if (step >= steps.length) {
            window.clearInterval(timer);
            window.setTimeout(finish, 420);
        }
    }, 480);
    window.addEventListener('keydown', (event) => { if (event.key === 'Escape') finish(); }, { once: true });
}

function setupVoiceControls() {
    const panel = document.querySelector('.chat-panel, .chat-deck');
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
    startBootSequence();
    setupProductivityFeatures();
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
    const startedAt = performance.now();
    try {
        const response = await fetch('/api/health/');
        const data = await response.json();
        const status = document.querySelector('.live');
        const footerStatus = document.querySelector('.sidebar-footer b');
        const runtimePill = document.querySelector('.core-panel .pill, .core-deck .pill');
        const healthy = response.ok && data.status === 'ok';
        const runtimeState = healthy ? (data.ai_configured ? 'online' : 'setup') : 'degraded';
        if (previousRuntimeState && previousRuntimeState !== runtimeState) {
            playJarvisTone(runtimeState === 'online' ? 'confirm' : 'warning');
            showJarvisToast(runtimeState === 'online' ? 'AI gateway connection restored.' : 'Runtime status requires attention.', runtimeState === 'online' ? 'success' : 'warning');
        }
        previousRuntimeState = runtimeState;
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
        const metrics = document.querySelectorAll('.metrics .metric, .tactical-metrics > div');
        if (metrics[0] && data.conversations !== undefined) metrics[0].querySelector('strong').textContent = String(data.conversations).padStart(2, '0');
        if (metrics[1] && data.messages !== undefined) metrics[1].querySelector('strong').textContent = String(data.messages);
        if (metrics[2]) metrics[2].querySelector('strong').innerHTML = `${((performance.now() - startedAt) / 1000).toFixed(2)}<span>s</span>`;
    } catch (error) {
        const status = document.querySelector('.live');
        if (status) status.innerHTML = '<i></i> DEGRADED';
        document.body.classList.add('runtime-degraded');
    }
}

// Keep the command center synchronized with the backend while it is open.
setInterval(refreshRuntimeStatus, 10000);

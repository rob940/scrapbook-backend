<script>
document.addEventListener("DOMContentLoaded", function() {
    // --- CONFIGURATION ---
    const config = {
        assistantId: "asst_VSXLUxXA8WJLdBQ64OKf84Bv",
        backendUrl: "https://scrapbook-concierge-backend.onrender.com",
        theme: {
            brandColor: "#333333",
            botAvatarUrl: "https://scrapbookfilms.com/site24/wp-content/uploads/2024/09/cropped-favicon.png",
            composerPlaceholder: "Ask about your story..."
        }
    };

    // --- STATE & STYLES ---
    let threadId = localStorage.getItem('sf_chat_thread_id') || null;
    let isChatOpen = false;
    const style = document.createElement('style');
    style.innerHTML = `
        :root { --sf-brand-color: ${config.theme.brandColor}; }
        .sf-chat-message a { color: var(--sf-brand-color); text-decoration: underline; }
        #sf-chat-bubble { position: fixed; bottom: 20px; right: 150px; width: 60px; height: 60px; background-color: var(--sf-brand-color); border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 5px 15px rgba(0,0,0,0.2); z-index: 99998; transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1); }
        #sf-chat-bubble:hover { transform: scale(1.1); } #sf-chat-bubble svg { width: 32px; height: 32px; fill: white; }
        #sf-chat-window { position: fixed; bottom: 90px; right: 20px; width: 370px; max-width: 90%; height: 600px; max-height: calc(100vh - 110px); background-color: #ffffff; border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); display: none; flex-direction: column; overflow: hidden; z-index: 99999; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
        #sf-chat-header { padding: 16px; background-color: var(--sf-brand-color); color: white; font-size: 18px; font-weight: 600; display: flex; align-items: center; flex-shrink: 0; }
        #sf-chat-header img { width: 40px; height: 40px; border-radius: 8px; margin-right: 12px; }
        #sf-chat-messages { flex-grow: 1; padding: 16px; overflow-y: auto; }
        .sf-chat-message { display: flex; margin-bottom: 12px; max-width: 85%; align-items: flex-end; }
        .sf-chat-message.user { margin-left: auto; flex-direction: row-reverse; }
        .sf-chat-message .bubble { padding: 12px 18px; border-radius: 22px; font-size: 15px; line-height: 1.5; word-break: break-word; }
        .sf-chat-message.bot .bubble { background-color: #f0f2f5; color: #1c1e21; border-bottom-left-radius: 6px; }
        .sf-chat-message.user .bubble { background-color: var(--sf-brand-color); color: white; border-bottom-right-radius: 6px; }
        #sf-chat-footer { border-top: 1px solid #e5e5e5; flex-shrink: 0; }
        #sf-chat-input-area { padding: 12px; display: flex; align-items: center; }
        #sf-chat-input { flex-grow: 1; border: 1px solid #ccc; border-radius: 20px; padding: 10px 18px; font-size: 15px; color: #333 !important; }
        #sf-chat-input:focus { outline: none; border-color: var(--sf-brand-color); box-shadow: 0 0 0 2px rgba(51, 51, 51, 0.2); }
        #sf-chat-send { background: var(--sf-brand-color); color: white; border: none; border-radius: 50%; width: 40px; height: 40px; margin-left: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .sf-typing-indicator { color: #888; font-style: italic; font-size: 13px; padding: 0 16px 8px 16px; }
        @media (max-width: 480px) { #sf-chat-window { width: 90%; right: 5%; bottom: 80px; height: 500px; } }
    `;
    document.head.appendChild(style);

    const bubble = document.createElement('div'); bubble.id = 'sf-chat-bubble'; bubble.innerHTML = `<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>`; document.body.appendChild(bubble);
    const chatWindow = document.createElement('div'); chatWindow.id = 'sf-chat-window';
    chatWindow.innerHTML = `<div id="sf-chat-header"><img src="${config.theme.botAvatarUrl}"><span>Scrapbook Films Concierge</span></div><div id="sf-chat-messages"></div><div id="sf-chat-footer"><div class="sf-typing-indicator" style="display: none;">Concierge is typing...</div><div id="sf-chat-input-area"><input type="text" id="sf-chat-input" placeholder="${config.theme.composerPlaceholder}"><button id="sf-chat-send"><svg fill="white" viewBox="0 0 24 24" width="24" height="24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button></div></div>`;
    document.body.appendChild(chatWindow);
    const messagesContainer = document.getElementById('sf-chat-messages'); const input = document.getElementById('sf-chat-input'); const sendButton = document.getElementById('sf-chat-send'); const typingIndicator = document.querySelector('.sf-typing-indicator');

    function addMessage(sender, text) {
        if (!text) return;
        let cleanText = text.replace(/【.*?】/g, '').replace(/\[CONTEXT:.*?\]/g, '').trim();
        if (!cleanText) return;
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        cleanText = cleanText.replace(urlRegex, '<a href="$1" target="_self">$1</a>');
        const displaySender = (sender === 'assistant') ? 'bot' : sender;
        const msgDiv = document.createElement('div');
        msgDiv.className = `sf-chat-message ${displaySender}`;
        msgDiv.innerHTML = `<div class="bubble">${cleanText.replace(/\n/g, '<br>')}</div>`;
        messagesContainer.appendChild(msgDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    let isStartingConversation = false;
    async function loadConversationHistory() { /* ... */ }; async function startConversation() { /* ... */ }; function toggleChat() { /* ... */ }; async function handleUserMessage(messageText) { /* ... */ };
    loadConversationHistory = async function() {
        if (!threadId) return; typingIndicator.style.display = 'block';
        try {
            const response = await fetch(`${config.backendUrl}/chat-history?threadId=${threadId}`);
            if (response.ok) {
                const data = await response.json(); messagesContainer.innerHTML = '';
                data.history.forEach(message => { if (message.content) addMessage(message.role, message.content); });
            } else { console.error("Could not load history, but threadId is preserved."); }
        } catch (error) { console.error("Failed to load history:", error); } 
        finally { typingIndicator.style.display = 'none'; }
    };
    startConversation = async function() {
        if (isStartingConversation || threadId) return; isStartingConversation = true; typingIndicator.style.display = 'block';
        await handleUserMessage("Start conversation"); isStartingConversation = false;
    };
    toggleChat = function() {
        isChatOpen = !isChatOpen; chatWindow.style.display = isChatOpen ? 'flex' : 'none';
        if (isChatOpen) { if (threadId && messagesContainer.children.length === 0) { loadConversationHistory(); } else if (!threadId) { startConversation(); } }
    };
    handleUserMessage = async function(messageText) {
        const userMessage = messageText.trim(); if (!userMessage) return; addMessage('user', userMessage); input.value = ''; typingIndicator.style.display = 'block'; sendButton.disabled = true;
        try {
            const response = await fetch(`${config.backendUrl}/chat`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    assistantId: config.assistantId, threadId: threadId, userMessage: userMessage,
                    currentPage: window.location.pathname, fullUrl: window.location.href, pageTitle: document.title
                })
            });
            if (!response.ok) throw new Error('Network response was notok.');
            const data = await response.json(); threadId = data.threadId; localStorage.setItem('sf_chat_thread_id', threadId); addMessage('bot', data.response);
        } catch (error) { console.error("Chat Error:", error); addMessage('bot', "I'm sorry, there was a problem connecting to the AI. Please try again later."); } 
        finally { typingIndicator.style.display = 'none'; sendButton.disabled = false; }
    };

    bubble.addEventListener('click', toggleChat);
    sendButton.addEventListener('click', () => handleUserMessage(input.value));
    input.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleUserMessage(input.value); });
});
</script>

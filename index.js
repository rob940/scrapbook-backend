// ✅ Scrapbook Films Chat Backend (Final, Robust Version with Server-Side Intercept)
const express = require('express');
const bodyParser = require('body-parser');
const OpenAI = require('openai');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const allowedOrigins = ['https://scrapbookfilms.com', 'https://www.scrapbookfilms.com'];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); }
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

const serviceUrls = {
    "Mini Memoirs": "https://scrapbookfilms.com/services/mini-memoirs/",
    "Little Hellos": "https://scrapbookfilms.com/services/little-hellos/",
    "Family Legacy Videos": "https://scrapbookfilms.com/services/family-legacy-videos/",
    "The Heirloom Archive": "https://scrapbookfilms.com/services/the-heirloom-archive/",
    "StoryLayers": "https://scrapbookfilms.com/services/storylayers/",
    "Memorial and Celebration of Life Videos": "https://scrapbookfilms.com/services/memorial-and-celebration-of-life-videos/",
    "Heritage Voices": "https://scrapbookfilms.com/services/heritage-voices/",
    "Journey To I Do Films": "https://scrapbookfilms.com/services/journey-to-i-do-films/",
    "Legacy Films for Business": "https://scrapbookfilms.com/services/legacy-films-for-business/",
    "Founder Films": "https://scrapbookfilms.com/services/founder-films/",
    "The Last Word": "https://scrapbookfilms.com/services/the-last-word/",
    "films": "https://scrapbookfilms.com/films/",
    "services": "https://scrapbookfilms.com/services-that-tell-your-story/"
};

app.get('/chat-history', async (req, res) => { /* ... unchanged ... */ });

app.post('/chat', async (req, res) => {
    const { assistantId, threadId, userMessage, currentPage } = req.body;
    try {
        let currentThreadId = threadId;
        if (!currentThreadId) {
            const thread = await openai.beta.threads.create();
            currentThreadId = thread.id;
        }

        // --- THE DEFINITIVE FIX: SERVER-SIDE INTERCEPT ---
        const lowerUserMessage = userMessage.toLowerCase();
        if (lowerUserMessage.includes('where can i') || lowerUserMessage.includes('show me')) {
            let foundService = null;
            for (const service in serviceUrls) {
                if (lowerUserMessage.includes(service.toLowerCase())) {
                    foundService = service;
                    break;
                }
            }

            if (foundService) {
                const url = serviceUrls[foundService];
                const botResponse = `Of course. You can find more about ${foundService} right here: ${url}`;

                // Add both messages to the history to fix persistence
                await openai.beta.threads.messages.create(currentThreadId, { role: "user", content: userMessage });
                await openai.beta.threads.messages.create(currentThreadId, { role: "assistant", content: botResponse });

                return res.json({ response: botResponse, threadId: currentThreadId });
            }
        }

        const contextualMessage = `${userMessage}\n[CONTEXT: On page ${currentPage || ''}]`;
        await openai.beta.threads.messages.create(currentThreadId, { role: "user", content: contextualMessage });

        let run = await openai.beta.threads.runs.create(currentThreadId, { assistant_id: assistantId });

        while (['in_progress', 'queued', 'requires_action'].includes(run.status)) {
            // ...polling and tool call logic is unchanged...
        }

        if (run.status === 'completed') {
            const messagesAfter = await openai.beta.threads.messages.list(currentThreadId, { order: 'desc' });
            const assistantResponse = messagesAfter.data.find(m => m.run_id === run.id && m.role === 'assistant');
            const responseText = assistantResponse?.content?.[0]?.text?.value || "I'm sorry, I couldn't formulate a response.";
            return res.json({ response: responseText, threadId: currentThreadId });
        } else {
            throw new Error(`Run ended with unhandled status: ${run.status}`);
        }
    } catch (error) {
        console.error("Chat Error:", error.message);
        return res.status(500).json({ error: "I'm sorry, there was a problem connecting to the AI." });
    }
});

// Unchanged code pasted for completeness
app.get('/chat-history', async (req, res) => {
    const { threadId } = req.query;
    if (!threadId) return res.status(400).json({ error: 'threadId is required' });
    try {
        const messages = await openai.beta.threads.messages.list(threadId, { order: 'asc' });
        const history = messages.data.filter(msg => msg.content?.[0]?.type === 'text').map(msg => {
            let content = msg.content[0]?.text?.value || '';
            if (msg.role === 'user') { content = content.replace(/\n\[CONTEXT:.*?\]/sg, '').trim(); }
            return { role: msg.role, content: content };
        });
        res.json({ history });
    } catch (error) { console.error("History Error:", error.message); res.status(500).json({ error: "Failed to fetch history." }); }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));

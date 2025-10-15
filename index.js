const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

// Flexible CORS: Allows requests from the base domain and its 'www' subdomain.
const allowedOrigins = ['https://scrapbookfilms.com', 'https://www.scrapbookfilms.com'];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

/**
 * Main webhook to execute tool calls from the OpenAI Assistant.
 */
app.post('/tools', async (req, res) => {
  // Normalize input to handle different webhook formats from OpenAI
  const tool = req.body.tool || 'create_contact'; // Assume default if not provided
  const args = req.body.args || req.body;

  if (tool === 'create_contact') {
    const { name, email, message, source } = args;

    // Basic server-side email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({ status: 'error', message: 'A valid email is required.' });
    }

    try {
      // Forward the contact information to Getform with required headers
      await axios.post(process.env.GETFORM_URL, 
        { name, email, message, source: source || 'Chatbot' },
        { headers: { 'Accept': 'application/json' } }
      );
      return res.json({ status: 'ok', confirmation: `Thanks, ${name}! We'll be in touch shortly.` });
    } catch (error) {
      console.error('Getform submission error:', error.message);
      return res.status(500).json({ status: 'error', message: 'Sorry, there was a problem sending your message.' });
    }
  }

  // Handle other tools like open_page if needed, though they are often client-side.
  if (tool === 'open_page') {
    return res.json({ status: 'ok', detail: 'Client-side tool acknowledged.' });
  }

  return res.status(400).json({ error: 'Unknown or unsupported tool' });
});

app.listen(3000, () => {
  console.log('Server is running on port 3000');
});

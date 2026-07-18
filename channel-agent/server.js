require('dotenv').config();
const express = require('express');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const ORCHESTRATE_URL = process.env.ORCHESTRATE_URL;
const SHARED_SECRET = process.env.SHARED_SECRET;

const SENDBLUE_API_KEY = process.env.SENDBLUE_API_KEY;
const SENDBLUE_API_SECRET = process.env.SENDBLUE_API_SECRET;
const SENDBLUE_PHONE_NUMBER = process.env.SENDBLUE_PHONE_NUMBER;

// --- shared envelope + orchestrator call -----------------------------

function toEnvelope({ channel, from_number, text, external_id }) {
  return {
    channel,
    from_number,
    text,
    external_id,
    timestamp: new Date().toISOString(),
  };
}

async function callOrchestrator(envelope) {
  const res = await fetch(ORCHESTRATE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(SHARED_SECRET ? { 'x-shared-secret': SHARED_SECRET } : {}),
    },
    body: JSON.stringify(envelope),
  });
  if (!res.ok) throw new Error(`orchestrate failed: ${res.status}`);
  const data = await res.json();
  return data.reply || data.text || "Sorry, I didn't get a response.";
}

// --- stub orchestrator (use until Part B's real endpoint is live) ----

app.post('/orchestrate-stub', (req, res) => {
  console.log('[stub] received envelope:', req.body);
  res.json({ reply: `(stub) got your message: "${req.body.text}"` });
});

// --- SendBlue text webhook --------------------------------------------
// Verify header names against your SendBlue dashboard before relying on
// this in the demo — docs didn't confirm exact header names at write time.

app.post('/text', async (req, res) => {
  try {
    const { from_number, content, message_handle } = req.body;
    if (!content) return res.sendStatus(200); // ignore non-text webhook events (status updates etc.)

    const envelope = toEnvelope({
      channel: 'text',
      from_number,
      text: content,
      external_id: message_handle,
    });

    const reply = await callOrchestrator(envelope);
    await sendSendBlue(from_number, reply);
    res.sendStatus(200);
  } catch (err) {
    console.error('text webhook error:', err);
    res.sendStatus(200); // always 200 so SendBlue doesn't retry-storm
  }
});

async function sendSendBlue(toNumber, content) {
  const res = await fetch('https://api.sendblue.co/api/send-message', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'sb-api-key-id': SENDBLUE_API_KEY,
      'sb-api-secret-key': SENDBLUE_API_SECRET,
    },
    body: JSON.stringify({
      number: toNumber,
      from_number: SENDBLUE_PHONE_NUMBER,
      content,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error('SendBlue send failed:', res.status, body);
  }
}

// --- Vapi custom-LLM webhook (voice) -----------------------------------
// Vapi POSTs an OpenAI-style { messages: [...] } body and expects an
// OpenAI-shaped chat.completion object back (non-streaming is fine).

app.post('/voice', async (req, res) => {
  try {
    const { messages, call } = req.body;
    const lastUserMsg = [...(messages || [])].reverse().find(m => m.role === 'user');
    const text = lastUserMsg ? lastUserMsg.content : '';
    const from_number = call?.customer?.number || 'unknown';
    // call.id is constant for the whole call; append turn index so each
    // turn gets a unique external_id (Part B dedupes/caches replies by it).
    const external_id = `${call?.id || 'unknown'}-${(messages || []).length}`;

    const envelope = toEnvelope({ channel: 'voice', from_number, text, external_id });
    const reply = await callOrchestrator(envelope);

    res.json({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'duebot-orchestrator',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: reply },
          finish_reason: 'stop',
        },
      ],
    });
  } catch (err) {
    console.error('voice webhook error:', err);
    res.json({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'duebot-orchestrator',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'One sec, let me check on that — having a small hiccup, try again in a moment.' },
          finish_reason: 'stop',
        },
      ],
    });
  }
});

app.listen(PORT, () => console.log(`channel-agent listening on :${PORT}`));

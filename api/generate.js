export default async function handler(req, res) {
    // CORS configuration (optional, but good if someone tries to hit the endpoint directly)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { systemPrompt, userInput, temperature } = req.body;
    const API_KEY = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    const MODEL = process.env.GEMINI_MODEL || process.env.VITE_GEMINI_MODEL || 'gemini-1.5-pro';

    if (!API_KEY) {
        return res.status(500).json({ error: 'API key is missing from environment variables.' });
    }

    if (!systemPrompt || !userInput) {
        return res.status(400).json({ error: 'Missing systemPrompt or userInput.' });
    }

    const ENDPOINT = `https://generativelanguage.googleapis.com/v1alpha/models/${MODEL}:generateContent?key=${API_KEY}`;

    try {
        const response = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemPrompt }] },
                contents: [{ parts: [{ text: userInput }] }],
                generationConfig: { temperature: temperature || 0.2, maxOutputTokens: 2000 }
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('Gemini API Error:', data);
            return res.status(response.status).json(data);
        }

        return res.status(200).json(data);
    } catch (error) {
        console.error('Error in /api/generate:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}

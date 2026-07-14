// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

const rooms = {};

// IMPORTANT: Wikipedia requires a User-Agent header
const wikiHeaders = {
    'User-Agent': 'WikiRaceGame/1.0 (contact: your-email@example.com) Axios/1.0'
};

async function getRandomArticle() {
    try {
        const res = await axios.get('https://en.wikipedia.org/api/rest_v1/page/random/summary', {
            headers: wikiHeaders
        });
        // Filter out undesirable page types if possible from summary, e.g., 'disambiguation'
        if (res.data.type === 'disambiguation' || res.data.title === 'Special:BadPage' || res.data.extract.length < 50) {
            console.log(`Skipping problematic random article: ${res.data.title}`);
            return getRandomArticle(); // Try again
        }
        return res.data.title;
    } catch (err) {
        console.error("Error getting random article:", err.message);
        return "Fruit"; // Fallback
    }
}

async function getArticleData(title) {
    try {
        const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&format=json&prop=text|links&mobileformat=1&origin=*`;
        const res = await axios.get(url, { headers: wikiHeaders });

        // --- IMPROVED ERROR CHECKING HERE ---
        // 1. Check for Wikipedia API errors (e.g., "missingtitle")
        if (res.data.error) {
            console.error("Wikipedia API 'parse' error for article:", title, res.data.error.info);
            return null; // Article truly not found or has an API issue
        }

        // 2. Check if the 'parse' object and its required properties are present
        // This handles cases where the page exists but cannot be parsed for content (e.g., special pages, some redirects)
        if (!res.data.parse || !res.data.parse.text || !res.data.parse.links) {
            console.warn(`Wikipedia API 'parse' data missing for title: "${title}". This might be a special page or a problematic redirect.`);
            return null; // Consider it 'not found' for our game's purpose
        }
        // --- END IMPROVED ERROR CHECKING ---
        
        const html = res.data.parse.text['*'];
        const links = res.data.parse.links.map(l => l['*']);
        return { html, links };
    } catch (err) {
        console.error(`Error fetching article data for "${title}":`, err.message);
        return null;
    }
}

// NEW FUNCTION: Fetch article summary
async function getArticleSummary(title) {
    try {
        const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
        const res = await axios.get(url, { headers: wikiHeaders });
        
        // --- IMPROVED ERROR CHECKING FOR SUMMARY ---
        // The summary API returns 200 for 'not found' but with specific content
        if (res.data.type === 'disambiguation' || res.data.title === 'Not found' || !res.data.extract) {
            console.warn(`Wikipedia summary API returned incomplete/non-standard data for: "${title}". Skipping.`);
            return null;
        }
        // --- END IMPROVED ERROR CHECKING FOR SUMMARY ---
        
        return res.data; // This typically includes title, extract, content_urls
    } catch (err) {
        console.error("Error fetching article summary:", err.message);
        return null;
    }
}

io.on('connection', (socket) => {
    socket.on('joinRoom', async ({ roomId, username }) => {
        socket.join(roomId);
        if (!rooms[roomId]) {
            rooms[roomId] = {
                players: {},
                startArticle: await getRandomArticle(),
                goalArticle: await getRandomArticle(),
                status: 'waiting'
            };
        }
        rooms[roomId].players[socket.id] = {
            id: socket.id,
            username,
            currentArticle: rooms[roomId].startArticle,
            history: [rooms[roomId].startArticle],
            clicks: 0,
            finished: false
        };
        io.to(roomId).emit('roomUpdate', rooms[roomId]);
    });

    socket.on('startGame', (roomId) => {
        if (rooms[roomId]) {
            rooms[roomId].status = 'playing';
            rooms[roomId].startTime = Date.now();
            io.to(roomId).emit('roomUpdate', rooms[roomId]);
        }
    });

    socket.on('navigate', async ({ roomId, targetTitle }) => {
        const room = rooms[roomId];
        const player = room?.players[socket.id];
        if (!room || !player || player.finished) return;

        // Normalize titles for comparison before setting, helps with goal checking
        const normalizedTarget = targetTitle.replace(/ /g, '_');
        
        player.currentArticle = normalizedTarget;
        player.clicks += 1;
        player.history.push(normalizedTarget);

        // Normalize goal article too for consistent comparison
        const normalizedGoal = room.goalArticle.replace(/ /g, '_');

        if (normalizedTarget.toLowerCase() === normalizedGoal.toLowerCase()) {
            player.finished = true;
            player.time = (Date.now() - room.startTime) / 1000;
        }

        io.to(roomId).emit('roomUpdate', room);
    });
});

app.get('/api/wiki/:title', async (req, res) => {
    const data = await getArticleData(req.params.title);
    if (data) res.json(data);
    else res.status(404).json({ error: "Article not found" }); // IMPORTANT: Send JSON even for 404
});

// NEW ENDPOINT: Get article summary
app.get('/api/wiki-summary/:title', async (req, res) => {
    const data = await getArticleSummary(req.params.title);
    if (data) res.json(data);
    else res.status(404).json({ error: "Summary not found" }); // Send JSON for 404
});

server.listen(3001, () => console.log('Server running on port 3001'));
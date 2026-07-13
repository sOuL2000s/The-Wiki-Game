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
        if (res.data.error) return null;
        
        const html = res.data.parse.text['*'];
        const links = res.data.parse.links.map(l => l['*']);
        return { html, links };
    } catch (err) {
        console.error("Error fetching article data:", err.message);
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

        player.currentArticle = targetTitle;
        player.clicks += 1;
        player.history.push(targetTitle);

        if (targetTitle.toLowerCase().replace(/ /g, '_') === room.goalArticle.toLowerCase().replace(/ /g, '_')) {
            player.finished = true;
            player.time = (Date.now() - room.startTime) / 1000;
        }

        io.to(roomId).emit('roomUpdate', room);
    });
});

app.get('/api/wiki/:title', async (req, res) => {
    const data = await getArticleData(req.params.title);
    if (data) res.json(data);
    else res.status(404).send("Not found");
});

server.listen(3001, () => console.log('Server running on port 3001'));

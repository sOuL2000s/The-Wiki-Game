// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const cors = require('cors');
const cheerio = require('cheerio'); // Import cheerio

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

// NEW FUNCTION: Clean Wikipedia HTML
function cleanWikipediaHtml(htmlContent) {
    const $ = cheerio.load(htmlContent);

    // 1. Remove unwanted elements based on common Wikipedia classes/structure
    $('.mw-editsection, .infobox, .navbox, .reference, .sistersitebox, .noprint, .metadata, .hatnote, .ambox, .dablink, .portalbox, .catlinks, .reflist, #References, #External_links, #See_also, #Further_reading, #Notes, #Bibliography, .printfooter, .vector-menu-content-list, .mw-cite-backlink, .mw-ui-button').remove();

    // 2. Remove all style attributes
    $('*').removeAttr('style');

    // 3. Remove most class attributes, except for specific ones we might want to preserve (e.g., for tables or special cases)
    // For simplicity, we'll remove most to avoid conflicts and re-style with Tailwind.
    $('*').each((i, el) => {
        const $el = $(el);
        // Only remove class if it's not a common semantic tag that might need a default styling
        // E.g., don't remove classes from <table>, <thead>, <tbody>, <th>, <td> if you plan to use those for specific table styling.
        // For now, let's be aggressive and remove all.
        $el.removeAttr('class');
        $el.removeAttr('id'); // Remove IDs as well to avoid conflicts
        $el.removeAttr('data-mw');
        $el.removeAttr('data-name');
        // $el.removeAttr('title'); // Remove original title to ensure our custom links work - Keep for external links
    });

    // 4. Adjust internal links: Ensure they only navigate within our game
    $('a').each((i, link) => {
        const $link = $(link);
        let href = $link.attr('href');
        let title = $link.attr('title'); // Wikipedia links often have a title attribute

        if (href && href.startsWith('/wiki/')) {
            // Keep only the path part and normalize it for the game
            const articleTitle = href.substring(6).split('#')[0]; // Remove /wiki/ and any #section
            // Re-set href to a simple # or data-title for frontend to intercept, or just use the title
            $link.attr('href', '#'); // Prevent default browser navigation
            $link.attr('data-title', decodeURIComponent(articleTitle).replace(/_/g, ' ')); // Store article title for frontend to pick up
            $link.removeAttr('title'); // Remove original title from internal links
        } else {
            // For external links, open in new tab and ensure a full URL if it's not already
            if (href && !href.startsWith('http')) {
                // Prepend base URL for truly relative external links (less common from parse API)
                $link.attr('href', 'https://en.wikipedia.org' + href);
            }
            $link.attr('target', '_blank'); // Open external links in new tab
            $link.attr('rel', 'noopener noreferrer');
        }
    });

    // 5. Make image source URLs absolute
    $('img').each((i, img) => {
        const $img = $(img);
        let src = $img.attr('src');
        if (src && src.startsWith('//')) {
            $img.attr('src', 'https:' + src);
        } else if (src && src.startsWith('/')) {
            // Handle relative paths for images, though Wikimedia usually uses // or full URLs
            $img.attr('src', 'https://en.wikipedia.org' + src);
        }
        // Ensure images are not too large by default if width/height are set
        $img.removeAttr('width').removeAttr('height');
    });

    // Add a class to tables for easier styling
    $('table').addClass('wiki-table');
    
    // Remove "IPA" pronunciations - often appear in parentheses and are not central to the game
    // This is a bit more aggressive and might remove some legitimate content, but common in article intros.
    $('span.IPA').remove();
    $('span[lang="en-fonipa"]').remove();
    $('a.mw-disambig').removeAttr('class'); // Remove this class to style as regular links

    return $.html();
}

// NEW FUNCTION: Get hints by finding common links
async function getHint(currentTitle, targetTitle) {
    try {
        const cur = currentTitle.replace(/_/g, ' ');
        const tar = targetTitle.replace(/_/g, ' ');

        // 1. Get links on current page and links to target
        // 2. Also get categories of target to provide "thematic" hints
        const [currentRes, targetRes, targetCats] = await Promise.all([
            axios.get(`https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(cur)}&prop=links&format=json`, { headers: wikiHeaders }),
            axios.get(`https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(tar)}&prop=linkshere&lhlimit=500&format=json`, { headers: wikiHeaders }),
            axios.get(`https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(tar)}&prop=categories&cllimit=50&format=json`, { headers: wikiHeaders })
        ]);

        if (currentRes.data.error || targetRes.data.error) return [];

        const currentLinks = currentRes.data.parse?.links?.map(l => l['*']) || [];
        const pages = targetRes.data.query?.pages || {};
        const pageId = Object.keys(pages)[0];
        const linksToTarget = pages[pageId]?.linkshere?.map(l => l.title) || [];

        // Direct 1-click hints
        const directHints = currentLinks.filter(link => linksToTarget.includes(link));
        if (directHints.length > 0) return directHints.slice(0, 3);

        // If no direct link, find links that share words with target title or its categories
        const tarWords = tar.toLowerCase().split(' ').filter(w => w.length > 3);
        const catPages = targetCats.data.query?.pages || {};
        const catPageId = Object.keys(catPages)[0];
        const categories = catPages[catPageId]?.categories?.map(c => c.title.replace('Category:', '').toLowerCase()) || [];
        
        const semanticHints = currentLinks.filter(link => {
            const l = link.toLowerCase();
            return tarWords.some(word => l.includes(word)) || categories.some(cat => l.includes(cat));
        });

        if (semanticHints.length > 0) return semanticHints.slice(0, 3);
        
        // Fallback: Significant links
        return currentLinks.filter(l => !/\d{4}/.test(l) && l.length > 5).slice(0, 2);
    } catch (err) {
        return [];
    }
}

async function getArticleData(title) {
    try {
        // Request mobile format for slightly cleaner HTML, but we'll clean it further
        const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&format=json&prop=text|links&mobileformat=1&origin=*`;
        const res = await axios.get(url, { headers: wikiHeaders });

        // --- IMPROVED ERROR CHECKING HERE ---
        if (res.data.error) {
            console.error("Wikipedia API 'parse' error for article:", title, res.data.error.info);
            return null;
        }

        if (!res.data.parse || !res.data.parse.text || !res.data.parse.links) {
            console.warn(`Wikipedia API 'parse' data missing for title: "${title}". This might be a special page or a problematic redirect.`);
            return null;
        }
        
        // Use the cleaning function here
        const rawHtml = res.data.parse.text['*'];
        const cleanedHtml = cleanWikipediaHtml(rawHtml); // Apply cleaning
        
        const links = res.data.parse.links.map(l => l['*']);
        return { html: cleanedHtml, links }; // Return cleaned HTML
    } catch (err) {
        console.error(`Error fetching article data for "${title}":`, err.message);
        return null;
    }
}

// NEW FUNCTION: Fetch article summary (already present, keep it)
async function getArticleSummary(title) {
    try {
        const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
        const res = await axios.get(url, { headers: wikiHeaders });
        
        if (res.data.type === 'disambiguation' || res.data.title === 'Not found' || !res.data.extract) {
            console.warn(`Wikipedia summary API returned incomplete/non-standard data for: "${title}". Skipping.`);
            return null;
        }
        
        return res.data;
    } catch (err) {
        console.error("Error fetching article summary:", err.message);
        return null;
    }
}

io.on('connection', (socket) => {
    socket.on('joinRoom', async ({ roomId, username }) => {
        socket.join(roomId);
        // Store roomId on the socket for easier lookup on disconnect
        socket.data.roomId = roomId;
        if (!rooms[roomId]) {
            rooms[roomId] = {
                players: {},
                startArticle: await getRandomArticle(),
                goalArticle: await getRandomArticle(),
                status: 'waiting',
                hostId: null // Initialize hostId
            };
        }
        
        // Assign host if this is the first player
        if (Object.keys(rooms[roomId].players).length === 0) {
            rooms[roomId].hostId = socket.id;
        }

        rooms[roomId].players[socket.id] = {
            id: socket.id,
            username,
            currentArticle: rooms[roomId].startArticle,
            history: [rooms[roomId].startArticle],
            clicks: 0,
            hintCount: 0,
            points: 0,
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

        // Normalize titles for Wikipedia API
        const normalizedTarget = targetTitle.replace(/ /g, '_');

        // IMPORTANT: Try to fetch the article data before committing to the navigation
        // This ensures we only navigate to existing, loadable articles
        const articleData = await getArticleData(normalizedTarget);

        if (!articleData) {
            // Article could not be found or loaded by the backend
            console.warn(`Player ${player.username} attempted to navigate to "${targetTitle}" which could not be loaded.`);
            socket.emit('articleNavigationError', {
                message: `Oops! We couldn't load "${targetTitle}". It might have been deleted, renamed, or there was a temporary issue.`,
                failedTargetTitle: targetTitle // Send the original target title back for a retry button
            });
            return; // Do not update player state or emit roomUpdate for this navigation
        }

        // If article data was successfully fetched, update player's state
        player.currentArticle = normalizedTarget;
        player.clicks += 1;
        player.history.push(normalizedTarget);
        player.points -= 10; // Deduct 10 points per click

        // Normalize goal article for consistent comparison (convert spaces to underscores)
        const normalizedGoal = room.goalArticle.replace(/ /g, '_');

        if (normalizedTarget.toLowerCase() === normalizedGoal.toLowerCase()) {
            player.finished = true;
            player.time = (Date.now() - room.startTime) / 1000;
            player.points += 1000; // Large bonus for reaching the goal
        }

        // Logic: If someone has finished, check if other players have already exceeded the winner's clicks
        const finishers = Object.values(room.players).filter(p => p.finished);
        if (finishers.length > 0) {
            const bestClicks = Math.min(...finishers.map(p => p.clicks));
            Object.values(room.players).forEach(p => {
                if (!p.finished && p.clicks > bestClicks) {
                    p.finished = true;
                    p.lost = true; // Mark as lost because they can't beat the current leader
                }
            });
        }

        // Check if everyone is finished
        const allFinished = Object.values(room.players).every(p => p.finished);
        if (allFinished) {
            room.status = 'finished';
        }

        // Emit room update to all players
        io.to(roomId).emit('roomUpdate', room);
    });

    socket.on('leaveRoom', ({ roomId }) => {
        handlePlayerLeave(socket, roomId); // Pass the socket object
        socket.emit('roomLeftConfirmation'); // Confirm to the leaving client
    });

    socket.on('disconnect', () => {
        const disconnectedFromRoomId = socket.data.roomId; // Use stored roomId
        if (disconnectedFromRoomId) {
            console.log(`Socket ${socket.id} disconnected from room ${disconnectedFromRoomId}`);
            handlePlayerLeave(socket, disconnectedFromRoomId); // Pass the socket object
        } else {
            console.log(`Socket ${socket.id} disconnected, not found in any active room (socket.data.roomId was not set).`);
        }
    });

    socket.on('requestHint', ({ roomId }) => {
        const room = rooms[roomId];
        const player = room?.players[socket.id];
        if (room && player && !player.finished && room.status === 'playing') {
            player.hintCount += 1;
            player.points -= 50; // Deduct 50 points per hint
            io.to(roomId).emit('roomUpdate', room);
        }
    });

    socket.on('chatMessage', ({ roomId, username, message }) => {
        const room = rooms[roomId];
        if (room && room.players[socket.id]) {
            // Sanitize message to prevent XSS
            const sanitizedMessage = message.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            io.to(roomId).emit('chatMessage', { username, message: sanitizedMessage, timestamp: Date.now() });
        }
    });
});

// Helper function to handle player leaving/disconnecting
function handlePlayerLeave(socket, roomId) { // Pass the socket object directly
    const socketId = socket.id; // Extract socketId from the socket object
    const room = rooms[roomId];
    if (room && room.players[socketId]) {
        const username = room.players[socketId].username;
        delete room.players[socketId];
        socket.leave(roomId); // This line now correctly uses the passed socket object

        // If the host leaves, assign a new host
        if (room.hostId === socketId) {
            const remainingPlayerIds = Object.keys(room.players);
            if (remainingPlayerIds.length > 0) {
                room.hostId = remainingPlayerIds[0];
                console.log(`Host of room ${roomId} changed to ${room.players[room.hostId].username}`);
            } else {
                room.hostId = null; // No host if no players
            }
        }

        if (Object.keys(room.players).length === 0) {
            delete rooms[roomId]; // Delete room if empty
            console.log(`Room ${roomId} is now empty and deleted.`);
        } else {
            io.to(roomId).emit('roomUpdate', room); // Notify remaining players
            // Also send a chat message that a player left
            io.to(roomId).emit('chatMessage', { username: 'System', message: `${username} has left the room.`, timestamp: Date.now() });
        }
        console.log(`Player ${username} (${socketId}) left room ${roomId}.`);
    }
}

app.get('/api/wiki/:title', async (req, res) => {
    const data = await getArticleData(req.params.title);
    if (data) res.json(data);
    else res.status(404).json({ error: "Article not found" });
});

app.get('/api/wiki-summary/:title', async (req, res) => {
    const data = await getArticleSummary(req.params.title);
    if (data) res.json(data);
    else res.status(404).json({ error: "Summary not found" });
});

app.get('/api/wiki-hint/:current/:target', async (req, res) => {
    const hints = await getHint(req.params.current, req.params.target);
    res.json({ hints });
});

const PORT = process.env.PORT || 3001; // Use Render's assigned port, or 3001 locally
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
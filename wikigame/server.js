// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const cors = require('cors');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

const wikiHeaders = {
    'User-Agent': 'WikiRaceGame/1.0 (contact: your-email@example.com) Axios/1.0'
};

// ---------- Persistence ----------
const DATA_FILE = path.join(__dirname, 'rooms-data.json');
const DISCONNECT_GRACE_MS = 120000; // Increased to 2 minutes
const AUTO_SAVE_INTERVAL = 10000; // Auto-save every 10 seconds

function loadRoomsFromDisk() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            // Restore room state with reconnection timers
            for (const [roomId, room] of Object.entries(data)) {
                // Convert stored timestamps to Date objects if needed
                if (room.lastActivity) {
                    room.lastActivity = new Date(room.lastActivity);
                }
                
                for (const [socketId, p] of Object.entries(room.players)) {
                    p.disconnected = true;
                    p.reconnectAttempts = 0;
                    p.lastSeen = Date.now();
                    p.disconnectTimer = setTimeout(() => {
                        removePlayerFromRoom(roomId, socketId);
                    }, DISCONNECT_GRACE_MS);
                }
            }
            return data;
        }
    } catch (err) {
        console.error("Failed to load rooms from disk:", err.message);
    }
    return {};
}

// Auto-save interval
setInterval(() => {
    saveRoomsToDisk();
}, AUTO_SAVE_INTERVAL);

// Improved save with compression and backup
function saveRoomsToDisk() {
    try {
        const serializable = {};
        for (const [roomId, room] of Object.entries(rooms)) {
            serializable[roomId] = {
                ...room,
                lastActivity: room.lastActivity ? room.lastActivity.toISOString() : null,
                players: Object.fromEntries(
                    Object.entries(room.players).map(([id, p]) => {
                        const { disconnectTimer, ...rest } = p;
                        return [id, rest];
                    })
                )
            };
        }
        
        // Write to main file
        fs.writeFileSync(DATA_FILE, JSON.stringify(serializable, null, 2), 'utf8');
        
        // Create backup
        const backupFile = DATA_FILE.replace('.json', '-backup.json');
        fs.writeFileSync(backupFile, JSON.stringify(serializable, null, 2), 'utf8');
    } catch (err) {
        console.error("Failed to save rooms to disk:", err.message);
    }
}



let saveTimeout = null;
const rooms = loadRoomsFromDisk(); // rooms needs to be defined for persistence functions

// Helper function to prepare room data for client emission (removes non-serializable objects)
function getCleanRoomData(room) {
    if (!room) return null;
    return {
        ...room,
        // Ensure lastActivity is a serializable string for clients
        lastActivity: room.lastActivity ? room.lastActivity.toISOString() : null,
        players: Object.fromEntries(
            Object.entries(room.players).map(([id, p]) => {
                // Remove the disconnectTimer (circular object) before sending to client
                const { disconnectTimer, ...cleanPlayer } = p;
                return [id, cleanPlayer];
            })
        )
    };
}

// --- Persistence Functions (defined early for hoisting/scoping) ---

// Schedule save function
function scheduleSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    // Give a short delay to batch multiple updates (e.g., rapid clicks)
    saveTimeout = setTimeout(saveRoomsToDisk, 1500);
}

// Save rooms to disk
function saveRoomsToDisk() {
    try {
        // Use the same cleaning logic for disk saving as for client emission
        const serializable = {};
        for (const [roomId, room] of Object.entries(rooms)) {
            serializable[roomId] = getCleanRoomData(room);
        }
        
        // Write to main file
        fs.writeFileSync(DATA_FILE, JSON.stringify(serializable, null, 2), 'utf8');
        
        // Create backup
        const backupFile = DATA_FILE.replace('.json', '-backup.json');
        fs.writeFileSync(backupFile, JSON.stringify(serializable, null, 2), 'utf8');
    } catch (err) {
        console.error("Failed to save rooms to disk:", err.message);
    }
}

// Removes a player for good (used both by explicit "leave" and by the
// disconnect grace-period timer once it expires).
function removePlayerFromRoom(roomId, socketId) {
    const room = rooms[roomId];
    if (!room || !room.players[socketId]) return;

    const username = room.players[socketId].username;
    if (room.players[socketId].disconnectTimer) {
        clearTimeout(room.players[socketId].disconnectTimer);
    }
    delete room.players[socketId];

    if (room.hostId === socketId) {
        const remainingPlayerIds = Object.keys(room.players);
        room.hostId = remainingPlayerIds.length > 0 ? remainingPlayerIds[0] : null;
    }

    if (Object.keys(room.players).length === 0) {
        delete rooms[roomId];
        console.log(`Room ${roomId} is now empty and deleted.`);
        scheduleSave(); // Save after deleting a room
        return;
    }

    room.lastActivity = new Date(); // Update activity on player removal
    io.to(roomId).emit('roomUpdate', getCleanRoomData(room));
    io.to(roomId).emit('chatMessage', { username: 'System', message: `${username} has left the room.`, timestamp: Date.now() });
    scheduleSave(); // Save after player state change
}

// Load rooms from disk
function loadRoomsFromDisk() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            // Restore room state with reconnection timers
            for (const [roomId, room] of Object.entries(data)) {
                // Convert stored timestamps to Date objects if needed
                if (room.lastActivity) {
                    room.lastActivity = new Date(room.lastActivity);
                }
                
                for (const [socketId, p] of Object.entries(room.players)) {
                    // When loading, assume all players are disconnected and set up a grace period
                    p.disconnected = true;
                    p.reconnectAttempts = 0; // Reset reconnect attempts on server restart
                    p.lastSeen = Date.now();
                    p.disconnectTimer = setTimeout(() => {
                        removePlayerFromRoom(roomId, socketId);
                    }, DISCONNECT_GRACE_MS);
                }
                // Ensure status is 'waiting' if not already 'playing' to allow host to restart
                if (room.status === 'playing' && Object.keys(room.players).length === 0) {
                    // If a game was playing but all players are gone after restart, reset its state
                    room.status = 'waiting'; 
                    room.startTime = null;
                }
            }
            return data;
        }
    } catch (err) {
        console.error("Failed to load rooms from disk:", err.message);
    }
    return {};
}

// Auto-save interval (should call saveRoomsToDisk directly)
setInterval(() => {
    saveRoomsToDisk();
}, AUTO_SAVE_INTERVAL);

// ----------------------------------

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
        return {
            title: res.data.title,
            pageid: res.data.pageid
        };
    } catch (err) {
        console.error("Error getting random article:", err.message);
        return { title: "Fruit", pageid: 5970 }; // Fallback
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

        // 1. Get current page data and target summary simultaneously
        const [articleData, targetSummary] = await Promise.all([
            getArticleData(cur),
            getArticleSummary(tar)
        ]);

        if (!articleData) return ["Try navigating to a more general topic first."];

        const currentLinks = articleData.links;

        // 2. Get links that lead TO the target article (backlinks) and target categories
        const [targetRes, targetCats] = await Promise.all([
            axios.get(`https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(tar)}&prop=linkshere&lhlimit=500&format=json`, { headers: wikiHeaders }),
            axios.get(`https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(tar)}&prop=categories&cllimit=50&format=json`, { headers: wikiHeaders })
        ]);

        const pages = targetRes.data.query?.pages || {};
        const pageId = Object.keys(pages)[0];
        const linksToTarget = pages[pageId]?.linkshere?.map(l => l.title) || [];

        // STRATEGY 0: Check if goal is directly linked
        if (currentLinks.some(l => l.toLowerCase() === tar.toLowerCase())) {
            return [tar];
        }

        // STRATEGY A: Direct 1-click connection (Level 2 BFS - Backlinks)
        const directHints = currentLinks.filter(link => linksToTarget.includes(link));
        if (directHints.length > 0) {
            return directHints.sort((a, b) => a.length - b.length).slice(0, 2);
        }

        // STRATEGY B: Semantic Scoring (Keyword Overlap)
        const getKeywords = (text) => text.toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .split(/\s+/)
            .filter(w => w.length > 4 && !['about', 'after', 'before', 'could', 'every', 'from', 'great', 'have', 'their', 'there', 'these', 'they', 'this', 'were', 'which', 'would'].includes(w));

        const targetKeywords = new Set([
            ...getKeywords(tar),
            ...(targetSummary ? getKeywords(targetSummary.extract) : [])
        ]);

        const scoredLinks = currentLinks.map(link => {
            const linkWords = getKeywords(link);
            let score = 0;
            linkWords.forEach(word => {
                if (targetKeywords.has(word)) score += 2;
                targetKeywords.forEach(tWord => {
                    if (tWord.includes(word) || word.includes(tWord)) score += 1;
                });
            });
            return { link, score };
        }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);

        if (scoredLinks.length > 0) return scoredLinks.slice(0, 2).map(i => i.link);

        // STRATEGY C: Category matching
        const catPages = targetCats.data.query?.pages || {};
        const catPageId = Object.keys(catPages)[0];
        const categories = (catPages[catPageId]?.categories?.map(c => c.title.replace('Category:', '').toLowerCase()) || [])
            .filter(c => !c.includes('articles') && !c.includes('wikipedia') && !c.includes('webarchive'));
        
        const catHints = currentLinks.filter(link => {
            const l = link.toLowerCase();
            return categories.some(cat => l.includes(cat) || cat.includes(l));
        });
        if (catHints.length > 0) return catHints.slice(0, 2);
        
        // STRATEGY D: General direction (Broad topics)
        const broadTopics = ['History', 'Geography', 'Science', 'Society', 'Culture', 'Technology', 'Mathematics', 'Philosophy', 'Art', 'Nature'];
        const broadHints = currentLinks.filter(l => broadTopics.some(t => l.includes(t)));
        if (broadHints.length > 0) return broadHints.slice(0, 2);

        return ["Try navigating to a more general topic first."];
    } catch (err) {
        console.error("Hint generation failed:", err.message);
        return ["Try a related major category."];
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
        
        // Extract links from the CLEANED HTML so hints match visible content
        const $ = cheerio.load(cleanedHtml);
        const visibleLinks = [];
        $('a[data-title]').each((i, el) => {
            const title = $(el).attr('data-title');
            // Only include mainspace links (no colons like Category:, Help:, etc)
            if (title && !title.includes(':') && !visibleLinks.includes(title)) {
                visibleLinks.push(title);
            }
        });

        return { 
            html: cleanedHtml, 
            links: visibleLinks, 
            title: res.data.parse.title, // Include the canonical title from the API
            pageid: res.data.parse.pageid
        }; 
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
        socket.data.roomId = roomId;
        socket.data.username = username;

        if (!rooms[roomId]) {
            const startArt = await getRandomArticle();
            const goalArt = await getRandomArticle();
            rooms[roomId] = {
                players: {},
                startArticle: startArt.title,
                goalArticle: goalArt.title,
                goalPageId: goalArt.pageid,
                status: 'waiting',
                hostId: null
            };
        }

        const room = rooms[roomId];

        // Reconnection: if a disconnected player with this username exists,
        // restore their progress instead of starting them over.
        const existingEntry = Object.entries(room.players).find(
            ([, p]) => p.disconnected && p.username.toLowerCase() === username.toLowerCase()
        );

        if (existingEntry) {
            const [oldSocketId, existingPlayer] = existingEntry;
            if (existingPlayer.disconnectTimer) clearTimeout(existingPlayer.disconnectTimer);
            delete existingPlayer.disconnectTimer;
            existingPlayer.disconnected = false;
            existingPlayer.id = socket.id;

            room.players[socket.id] = existingPlayer;
            delete room.players[oldSocketId];
            if (room.hostId === oldSocketId) room.hostId = socket.id;

            io.to(roomId).emit('chatMessage', { username: 'System', message: `${username} reconnected.`, timestamp: Date.now() });
        } else if (!room.players[socket.id]) {
            if (Object.keys(room.players).length === 0) {
                room.hostId = socket.id;
            }
            room.players[socket.id] = {
                id: socket.id,
                username,
                currentArticle: room.startArticle,
                history: [room.startArticle],
                clicks: 0,
                hintCount: 0,
                points: 0,
                finished: false,
                disconnected: false
            };
        }

        scheduleSave();
        io.to(roomId).emit('roomUpdate', getCleanRoomData(room));
    });

    socket.on('startGame', (roomId) => {
        if (rooms[roomId]) {
            rooms[roomId].status = 'playing';
            rooms[roomId].startTime = Date.now();
            scheduleSave();
            io.to(roomId).emit('roomUpdate', getCleanRoomData(rooms[roomId]));
        }
    });

    socket.on('playAgain', async (roomId) => {
        if (rooms[roomId] && (rooms[roomId].status === 'finished' || rooms[roomId].status === 'playing')) {
            if (rooms[roomId].hostId !== socket.id) return;

            const startArt = await getRandomArticle();
            const goalArt = await getRandomArticle();
            rooms[roomId].status = 'waiting';
            rooms[roomId].startArticle = startArt.title;
            rooms[roomId].goalArticle = goalArt.title;
            rooms[roomId].goalPageId = goalArt.pageid;
            rooms[roomId].startTime = null;

            Object.keys(rooms[roomId].players).forEach(id => {
                const p = rooms[roomId].players[id];
                p.currentArticle = rooms[roomId].startArticle;
                p.history = [rooms[roomId].startArticle];
                p.clicks = 0;
                p.hintCount = 0;
                p.points = 0;
                p.finished = false;
                p.lost = false;
                delete p.time;
            });

            scheduleSave();
            io.to(roomId).emit('roomUpdate', getCleanRoomData(rooms[roomId]));
            io.to(roomId).emit('chatMessage', { username: 'System', message: 'The game has been reset for a new round!', timestamp: Date.now() });
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

        // Use the actual title returned from Wikipedia API (handles redirects)
        const canonicalTitle = articleData.title.replace(/ /g, '_');
        const currentPageId = articleData.pageid;

        // If article data was successfully fetched, update player's state
        player.currentArticle = canonicalTitle;
        player.clicks += 1;
        player.history.push(canonicalTitle);
        player.points -= 10; // Deduct 10 points per click

        // Compare using pageId for more reliable win detection (handles redirects/normalization)
        if (currentPageId === room.goalPageId) {
            player.finished = true;
            player.time = (Date.now() - room.startTime) / 1000;
            player.points += Math.max(0, 1000 - (player.clicks * 20)); // Bonus points based on efficiency
            io.to(roomId).emit('chatMessage', { username: 'System', message: `${player.username} reached the goal in ${player.clicks} clicks!`, timestamp: Date.now() });
        }

        // Logic: If someone has finished, check if other players have already exceeded the winner's clicks
        // In a "Competitive" race, you can't win if you have more clicks than the current winner
        const finishers = Object.values(room.players).filter(p => p.finished && !p.lost);
        if (finishers.length > 0) {
            const bestClicks = Math.min(...finishers.map(p => p.clicks));
            Object.values(room.players).forEach(p => {
                if (!p.finished && p.clicks > bestClicks) {
                    p.finished = true;
                    p.lost = true; // Mark as lost because they can't beat the current leader
                    io.to(roomId).emit('chatMessage', { username: 'System', message: `${p.username} has been eliminated (too many clicks).`, timestamp: Date.now() });
                }
            });
        }

        // Check if everyone is finished
        const allFinished = Object.values(room.players).every(p => p.finished);
        if (allFinished) {
            room.status = 'finished';
        }

        scheduleSave();
        io.to(roomId).emit('roomUpdate', getCleanRoomData(room));
    });

    socket.on('leaveRoom', ({ roomId }) => {
        socket.leave(roomId);
        removePlayerFromRoom(roomId, socket.id);
        socket.emit('roomLeftConfirmation');
    });

    socket.on('disconnect', () => {
        const roomId = socket.data.roomId;
        const room = roomId && rooms[roomId];
        const player = room && room.players[socket.id];
        if (!player) return;

        // Don't remove immediately — give them a window to reconnect
        // (covers page reloads, brief network drops, tab switches, etc).
        player.disconnected = true;
        player.disconnectTimer = setTimeout(() => {
            removePlayerFromRoom(roomId, socket.id);
        }, DISCONNECT_GRACE_MS);

        scheduleSave();
        io.to(roomId).emit('roomUpdate', getCleanRoomData(room));
        io.to(roomId).emit('chatMessage', {
            username: 'System',
            message: `${player.username} lost connection. They have a minute or two to reconnect...`,
            timestamp: Date.now()
        });
    });

    socket.on('requestHint', ({ roomId }) => {
        const room = rooms[roomId];
        const player = room?.players[socket.id];
        if (room && player && !player.finished && room.status === 'playing') {
            player.hintCount += 1;
            player.points -= 50;
            scheduleSave();
            io.to(roomId).emit('roomUpdate', getCleanRoomData(room));
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
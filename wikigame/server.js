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

// ---------- Game timing & AI solver ----------
const ROUND_DURATION_MS = parseInt(process.env.ROUND_DURATION_MS || `${5 * 60 * 1000}`, 10);
const SOLVER_MAX_DEPTH = 6;              // hard cap on hops
const SOLVER_MAX_LINKS_PER_NODE = 300;   // cap fan-out (major links only)
const SOLVER_NODE_BUDGET = 4000;         // stop expanding after N article fetches
const SOLVER_TIMEOUT_MS = 90 * 1000;     // wall clock cap
const SOLVER_LAYER_DELAY_MS = 60;        // gentle pacing
const CLOSENESS_PROBE_TIMEOUT_MS = 1500; // per-player remaining-distance probe

// ---------- Persistence ----------
const DATA_FILE = path.join(__dirname, 'rooms-data.json');
const DISCONNECT_GRACE_MS = 120000;
const AUTO_SAVE_INTERVAL = 10000;

let saveTimeout = null;
const rooms = loadRoomsFromDisk();

// --- Helpers ---
function normalizeTitle(t) {
    return String(t || '').replace(/_/g, ' ').trim();
}

function getCleanRoomData(room) {
    if (!room) return null;
    return {
        ...room,
        lastActivity: room.lastActivity ? room.lastActivity.toISOString() : null,
        players: Object.fromEntries(
            Object.entries(room.players).map(([id, p]) => {
                const { disconnectTimer, ...cleanPlayer } = p;
                return [id, cleanPlayer];
            })
        )
    };
}

function scheduleSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveRoomsToDisk, 1500);
}

function saveRoomsToDisk() {
    try {
        const serializable = {};
        for (const [roomId, room] of Object.entries(rooms)) {
            serializable[roomId] = getCleanRoomData(room);
        }
        fs.writeFileSync(DATA_FILE, JSON.stringify(serializable, null, 2), 'utf8');
        const backupFile = DATA_FILE.replace('.json', '-backup.json');
        fs.writeFileSync(backupFile, JSON.stringify(serializable, null, 2), 'utf8');
    } catch (err) {
        console.error("Failed to save rooms to disk:", err.message);
    }
}

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
        scheduleSave();
        return;
    }

    room.lastActivity = new Date();
    io.to(roomId).emit('roomUpdate', getCleanRoomData(room));
    io.to(roomId).emit('chatMessage', { username: 'System', message: `${username} has left the room.`, timestamp: Date.now() });
    scheduleSave();
}

function loadRoomsFromDisk() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            for (const [roomId, room] of Object.entries(data)) {
                if (room.lastActivity) room.lastActivity = new Date(room.lastActivity);
                if (room.roundEndsAt === undefined) room.roundEndsAt = null;
                if (room.aiSolution === undefined) room.aiSolution = null;
                if (room.aiSolving === undefined) room.aiSolving = false;
                if (room.finalRanking === undefined) room.finalRanking = null;
                if (room.endReason === undefined) room.endReason = null;
                if (room.solverToken === undefined) room.solverToken = 0;

                for (const [socketId, p] of Object.entries(room.players)) {
                    p.disconnected = true;
                    p.reconnectAttempts = 0;
                    p.lastSeen = Date.now();
                    p.disconnectTimer = setTimeout(() => {
                        removePlayerFromRoom(roomId, socketId);
                    }, DISCONNECT_GRACE_MS);
                }
                if (room.status === 'playing' && Object.keys(room.players).length === 0) {
                    room.status = 'waiting';
                    room.startTime = null;
                    room.roundEndsAt = null;
                }
            }
            return data;
        }
    } catch (err) {
        console.error("Failed to load rooms from disk:", err.message);
    }
    return {};
}

setInterval(() => { saveRoomsToDisk(); }, AUTO_SAVE_INTERVAL);

// Timer tick
setInterval(() => {
    const now = Date.now();
    for (const [roomId, room] of Object.entries(rooms)) {
        if (room.status === 'playing' && room.roundEndsAt && now >= room.roundEndsAt) {
            endRound(roomId, 'timeout');
        }
    }
}, 1000);

// ---------- Wikipedia helpers ----------
async function getRandomArticle() {
    try {
        const res = await axios.get('https://en.wikipedia.org/api/rest_v1/page/random/summary', {
            headers: wikiHeaders
        });
        if (res.data.type === 'disambiguation' || res.data.title === 'Special:BadPage' || res.data.extract.length < 50) {
            console.log(`Skipping problematic random article: ${res.data.title}`);
            return getRandomArticle();
        }
        return { title: res.data.title, pageid: res.data.pageid };
    } catch (err) {
        console.error("Error getting random article:", err.message);
        return { title: "Fruit", pageid: 5970 };
    }
}

function cleanWikipediaHtml(htmlContent) {
    const $ = cheerio.load(htmlContent);

    $('.mw-editsection, .infobox, .navbox, .reference, .sistersitebox, .noprint, .metadata, .hatnote, .ambox, .dablink, .portalbox, .catlinks, .reflist, #References, #External_links, #See_also, #Further_reading, #Notes, #Bibliography, .printfooter, .vector-menu-content-list, .mw-cite-backlink, .mw-ui-button').remove();
    $('*').removeAttr('style');

    $('*').each((i, el) => {
        const $el = $(el);
        $el.removeAttr('class');
        $el.removeAttr('id');
        $el.removeAttr('data-mw');
        $el.removeAttr('data-name');
    });

    $('a').each((i, link) => {
        const $link = $(link);
        let href = $link.attr('href');
        if (href && href.startsWith('/wiki/')) {
            const articleTitle = href.substring(6).split('#')[0];
            $link.attr('href', '#');
            $link.attr('data-title', decodeURIComponent(articleTitle).replace(/_/g, ' '));
            $link.removeAttr('title');
        } else {
            if (href && !href.startsWith('http')) {
                $link.attr('href', 'https://en.wikipedia.org' + href);
            }
            $link.attr('target', '_blank');
            $link.attr('rel', 'noopener noreferrer');
        }
    });

    $('img').each((i, img) => {
        const $img = $(img);
        let src = $img.attr('src');
        if (src && src.startsWith('//')) {
            $img.attr('src', 'https:' + src);
        } else if (src && src.startsWith('/')) {
            $img.attr('src', 'https://en.wikipedia.org' + src);
        }
        $img.removeAttr('width').removeAttr('height');
    });

    $('table').addClass('wiki-table');
    $('span.IPA').remove();
    $('span[lang="en-fonipa"]').remove();
    $('a.mw-disambig').removeAttr('class');

    return $.html();
}

// Fetch mainspace outgoing links for a title. Returns { canonicalTitle, links } or null.
async function getLinksForTitle(title) {
    try {
        const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&format=json&prop=links&redirects=1&origin=*`;
        const res = await axios.get(url, { headers: wikiHeaders, timeout: 15000 });
        if (res.data.error || !res.data.parse?.links) return null;

        const links = res.data.parse.links
            .filter(l => l.ns === 0 && l.exists !== false)
            .map(l => normalizeTitle(l['*']))
            .filter(t => t && !t.includes(':'))
            .slice(0, SOLVER_MAX_LINKS_PER_NODE);

        return { canonicalTitle: normalizeTitle(res.data.parse.title), links };
    } catch (err) {
        return null;
    }
}

/**
 * CORRECTED SOLVER — plain unidirectional BFS.
 *
 * Why this is correct where the old bidirectional one was not:
 *   - Every node stores exactly one `parent` = the node it was FIRST discovered from.
 *   - Reconstruction walks parents from goal → start, so every hop is a real
 *     `parent → child` link that we actually observed via getLinksForTitle.
 *   - No mixing of forward/backward parent maps, so no phantom edges.
 *
 * Cost: bounded by SOLVER_NODE_BUDGET + SOLVER_MAX_DEPTH + SOLVER_TIMEOUT_MS.
 * Wikipedia is small-world (diameter ~4), so in practice this finishes in 1–3s.
 */
async function solveOptimalPath(startTitle, goalTitle) {
    const t0 = Date.now();
    const start = normalizeTitle(startTitle);
    const goal = normalizeTitle(goalTitle);

    if (start === goal) {
        return { path: [start], clicks: 0, timeMs: 0, found: true };
    }

    // parent map: title -> parent title (or null for start)
    const parent = new Map();
    parent.set(start, null);
    // For the goal, we want to recognize it either by exact title or by
    // canonical title returned from the API (in case goal title is a redirect).
    let goalCanonical = goal;

    let layer = [start];
    let nodesFetched = 0;
    let depth = 0;
    let found = false;

    while (layer.length > 0 && depth < SOLVER_MAX_DEPTH && !found) {
        if (Date.now() - t0 > SOLVER_TIMEOUT_MS) break;
        if (nodesFetched >= SOLVER_NODE_BUDGET) break;

        // Fetch this entire layer in parallel (bounded)
        const fetchable = layer.slice(0, Math.max(1, SOLVER_NODE_BUDGET - nodesFetched));
        const results = await Promise.all(fetchable.map(t => getLinksForTitle(t)));
        nodesFetched += fetchable.length;

        const nextLayer = [];
        for (let i = 0; i < fetchable.length; i++) {
            const title = fetchable[i];
            const data = results[i];
            if (!data) continue;

            // If this node was a redirect, note its canonical name.
            // (Useful in case the goal is written as a redirect.)
            if (data.canonicalTitle && data.canonicalTitle !== title) {
                // Alias it so we don't lose the path through the redirect target
                if (!parent.has(data.canonicalTitle)) {
                    parent.set(data.canonicalTitle, parent.get(title));
                }
            }

            for (const link of data.links) {
                if (parent.has(link)) continue;
                parent.set(link, title);
                nextLayer.push(link);

                if (link === goal || link === goalCanonical) {
                    found = true;
                    break;
                }
            }
            if (found) break;
        }

        if (found) break;
        layer = nextLayer;
        depth++;
        if (SOLVER_LAYER_DELAY_MS > 0) {
            await new Promise(r => setTimeout(r, SOLVER_LAYER_DELAY_MS));
        }
    }

    if (!found) {
        return { path: [], clicks: -1, timeMs: Date.now() - t0, found: false };
    }

    // Reconstruct goal → start, then reverse.
    const path = [];
    let cur = goal;
    // If we found via canonical alias, use the canonical key.
    if (!parent.has(cur)) {
        // try to find any key equal to goalCanonical
        cur = goalCanonical;
        if (!parent.has(cur)) {
            return { path: [], clicks: -1, timeMs: Date.now() - t0, found: false };
        }
    }
    while (cur !== null && cur !== undefined) {
        path.unshift(cur);
        cur = parent.get(cur);
    }

    // Sanity: verify every consecutive pair is a real edge we observed.
    // We don't re-fetch here (too expensive); trust the parent map, which
    // only ever stored edges from getLinksForTitle output.

    return {
        path,
        clicks: path.length - 1,
        timeMs: Date.now() - t0,
        found: true,
    };
}

// Small BFS used at endRound to measure remaining distance from a player's
// current article to the goal. Returns -1 if not reachable within limits.
async function shortestRemainingDistance(fromTitle, goalTitle, maxDepth = 4, nodeBudget = 300, timeoutMs = CLOSENESS_PROBE_TIMEOUT_MS) {
    const t0 = Date.now();
    const start = normalizeTitle(fromTitle);
    const goal = normalizeTitle(goalTitle);
    if (start === goal) return 0;

    const visited = new Set([start]);
    let layer = [start];
    let depth = 0;
    let fetched = 0;

    while (layer.length > 0 && depth < maxDepth) {
        if (Date.now() - t0 > timeoutMs) break;
        if (fetched >= nodeBudget) break;
        const slice = layer.slice(0, Math.max(1, nodeBudget - fetched));
        const results = await Promise.all(slice.map(t => getLinksForTitle(t)));
        fetched += slice.length;

        const next = [];
        for (let i = 0; i < slice.length; i++) {
            const data = results[i];
            if (!data) continue;
            for (const link of data.links) {
                if (visited.has(link)) continue;
                if (link === goal) return depth + 1;
                visited.add(link);
                next.push(link);
            }
        }
        layer = next;
        depth++;
    }
    return -1;
}

async function getHint(currentTitle, targetTitle) {
    try {
        const cur = currentTitle.replace(/_/g, ' ');
        const tar = targetTitle.replace(/_/g, ' ');

        const [articleData, targetSummary] = await Promise.all([
            getArticleData(cur),
            getArticleSummary(tar)
        ]);

        if (!articleData) return ["Try navigating to a more general topic first."];

        const currentLinks = articleData.links;

        const [targetRes, targetCats] = await Promise.all([
            axios.get(`https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(tar)}&prop=linkshere&lhlimit=500&format=json`, { headers: wikiHeaders }),
            axios.get(`https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(tar)}&prop=categories&cllimit=50&format=json`, { headers: wikiHeaders })
        ]);

        const pages = targetRes.data.query?.pages || {};
        const pageId = Object.keys(pages)[0];
        const linksToTarget = pages[pageId]?.linkshere?.map(l => l.title) || [];

        if (currentLinks.some(l => l.toLowerCase() === tar.toLowerCase())) {
            return [tar];
        }

        const directHints = currentLinks.filter(link => linksToTarget.includes(link));
        if (directHints.length > 0) {
            return directHints.sort((a, b) => a.length - b.length).slice(0, 2);
        }

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

        const catPages = targetCats.data.query?.pages || {};
        const catPageId = Object.keys(catPages)[0];
        const categories = (catPages[catPageId]?.categories?.map(c => c.title.replace('Category:', '').toLowerCase()) || [])
            .filter(c => !c.includes('articles') && !c.includes('wikipedia') && !c.includes('webarchive'));

        const catHints = currentLinks.filter(link => {
            const l = link.toLowerCase();
            return categories.some(cat => l.includes(cat) || cat.includes(l));
        });
        if (catHints.length > 0) return catHints.slice(0, 2);

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
        const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&format=json&prop=text|links&mobileformat=1&origin=*`;
        const res = await axios.get(url, { headers: wikiHeaders });

        if (res.data.error) {
            console.error("Wikipedia API 'parse' error for article:", title, res.data.error.info);
            return null;
        }

        if (!res.data.parse || !res.data.parse.text || !res.data.parse.links) {
            console.warn(`Wikipedia API 'parse' data missing for title: "${title}".`);
            return null;
        }

        const rawHtml = res.data.parse.text['*'];
        const cleanedHtml = cleanWikipediaHtml(rawHtml);

        const $ = cheerio.load(cleanedHtml);
        const visibleLinks = [];
        $('a[data-title]').each((i, el) => {
            const title = $(el).attr('data-title');
            if (title && !title.includes(':') && !visibleLinks.includes(title)) {
                visibleLinks.push(title);
            }
        });

        return {
            html: cleanedHtml,
            links: visibleLinks,
            title: res.data.parse.title,
            pageid: res.data.parse.pageid
        };
    } catch (err) {
        console.error(`Error fetching article data for "${title}":`, err.message);
        return null;
    }
}

async function getArticleSummary(title) {
    try {
        const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
        const res = await axios.get(url, { headers: wikiHeaders });

        if (res.data.type === 'disambiguation' || res.data.title === 'Not found' || !res.data.extract) {
            console.warn(`Wikipedia summary API returned incomplete data for: "${title}".`);
            return null;
        }

        return res.data;
    } catch (err) {
        console.error("Error fetching article summary:", err.message);
        return null;
    }
}

// Compute how close a player is to the goal using real BFS distance.
async function computeRemainingDistance(room, player) {
    if (!player || !player.currentArticle) return -1;
    return shortestRemainingDistance(player.currentArticle, room.goalArticle);
}

async function endRound(roomId, reason) {
    const room = rooms[roomId];
    if (!room || room.status === 'finished') return;

    room.status = 'finished';
    room.roundEndsAt = null;
    room.endReason = reason;

    const players = Object.values(room.players);

    // For unfinished players, probe their real remaining distance in parallel.
    const distanceMap = new Map();
    await Promise.all(players.map(async p => {
        if (p.finished) {
            distanceMap.set(p.id, p.lost ? Infinity : -p.clicks); // finished/win sorts by clicks
        } else {
            try {
                const d = await computeRemainingDistance(room, p);
                distanceMap.set(p.id, d);
            } catch {
                distanceMap.set(p.id, -1);
            }
        }
    }));

    players.sort((a, b) => {
        const aWin = a.finished && !a.lost;
        const bWin = b.finished && !b.lost;
        if (aWin && !bWin) return -1;
        if (bWin && !aWin) return 1;
        if (aWin && bWin) return (a.clicks || 0) - (b.clicks || 0);

        const ad = distanceMap.get(a.id);
        const bd = distanceMap.get(b.id);
        // Players who have a real distance (>=0) rank above those with -1 (unknown)
        if (ad >= 0 && bd < 0) return -1;
        if (bd >= 0 && ad < 0) return 1;
        if (ad >= 0 && bd >= 0) {
            if (ad !== bd) return ad - bd; // smaller = closer = better
            return (a.clicks || 0) - (b.clicks || 0);
        }
        // Both unknown: more clicks is a weak signal of progress
        return (b.clicks || 0) - (a.clicks || 0);
    });

    room.finalRanking = players.map(p => {
        const raw = distanceMap.get(p.id);
        return {
            id: p.id,
            username: p.username,
            clicks: p.clicks,
            finished: p.finished,
            lost: !!p.lost,
            time: p.time ?? null,
            // Store either real remaining distance (>=0) or -1 if unknown.
            closeness: p.finished && !p.lost ? 0 : (raw >= 0 ? raw : -1),
        };
    });

    scheduleSave();
    io.to(roomId).emit('roomUpdate', getCleanRoomData(room));
    io.to(roomId).emit('chatMessage', {
        username: 'System',
        message: reason === 'timeout'
            ? "⏰ Time's up! The race has ended."
            : '🏁 All players have finished!',
        timestamp: Date.now(),
    });
}

// Solver orchestration with token guard.
function startSolverForRoom(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    const token = (room.solverToken || 0) + 1;
    room.solverToken = token;
    room.aiSolving = true;
    room.aiSolution = null;

    const startTitle = room.startArticle;
    const goalTitle = room.goalArticle;

    solveOptimalPath(startTitle, goalTitle)
        .then(sol => {
            const r = rooms[roomId];
            if (!r || r.solverToken !== token) return;
            if (r.startArticle !== startTitle || r.goalArticle !== goalTitle) return;
            r.aiSolution = sol;
            r.aiSolving = false;
            scheduleSave();
            io.to(roomId).emit('roomUpdate', getCleanRoomData(r));
        })
        .catch(err => {
            console.error('Solver failed:', err.message);
            const r = rooms[roomId];
            if (!r || r.solverToken !== token) return;
            r.aiSolution = { path: [], clicks: -1, timeMs: 0, found: false };
            r.aiSolving = false;
            io.to(roomId).emit('roomUpdate', getCleanRoomData(r));
        });
}

// ----------------------------------
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
                hostId: null,
                roundEndsAt: null,
                aiSolution: null,
                aiSolving: false,
                finalRanking: null,
                endReason: null,
                solverToken: 0,
            };
            startSolverForRoom(roomId);
        }

        const room = rooms[roomId];

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
            rooms[roomId].roundEndsAt = Date.now() + ROUND_DURATION_MS;
            rooms[roomId].endReason = null;
            rooms[roomId].finalRanking = null;
            scheduleSave();
            io.to(roomId).emit('roomUpdate', getCleanRoomData(rooms[roomId]));
            io.to(roomId).emit('chatMessage', {
                username: 'System',
                message: `Race started! You have ${Math.round(ROUND_DURATION_MS / 60000)} minute(s).`,
                timestamp: Date.now(),
            });
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
            rooms[roomId].roundEndsAt = null;
            rooms[roomId].aiSolution = null;
            rooms[roomId].aiSolving = false;
            rooms[roomId].finalRanking = null;
            rooms[roomId].endReason = null;

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
            io.to(roomId).emit('chatMessage', { username: 'System', message: 'New round! Solver is computing the optimal path...', timestamp: Date.now() });

            startSolverForRoom(roomId);
        }
    });

    // Core navigation handler
    socket.on('navigate', async ({ roomId, targetTitle }) => {
        const room = rooms[roomId];
        const player = room?.players[socket.id];
        if (!room || !player || player.finished) return;
        if (room.status !== 'playing') return;
        if (room.roundEndsAt && Date.now() >= room.roundEndsAt) return;

        const normalizedTarget = targetTitle.replace(/ /g, '_');
        const articleData = await getArticleData(normalizedTarget);

        if (!articleData) {
            socket.emit('articleNavigationError', {
                message: `Oops! We couldn't load "${targetTitle}". It might have been deleted, renamed, or there was a temporary issue.`,
                failedTargetTitle: targetTitle
            });
            return;
        }

        // Guard against duplicate rapid clicks on the same target
        const canonicalTitle = articleData.title.replace(/ /g, '_');
        if (player.currentArticle === canonicalTitle) return;

        player.currentArticle = canonicalTitle;
        player.clicks += 1;
        player.history.push(canonicalTitle);
        player.points -= 10;

        if (articleData.pageid === room.goalPageId) {
            player.finished = true;
            player.time = (Date.now() - room.startTime) / 1000;
            player.points += Math.max(0, 1000 - (player.clicks * 20));
            io.to(roomId).emit('chatMessage', { username: 'System', message: `${player.username} reached the goal in ${player.clicks} clicks!`, timestamp: Date.now() });
        }

        const finishers = Object.values(room.players).filter(p => p.finished && !p.lost);
        if (finishers.length > 0) {
            const bestClicks = Math.min(...finishers.map(p => p.clicks));
            Object.values(room.players).forEach(p => {
                if (!p.finished && p.clicks > bestClicks) {
                    p.finished = true;
                    p.lost = true;
                    io.to(roomId).emit('chatMessage', { username: 'System', message: `${p.username} has been eliminated (too many clicks).`, timestamp: Date.now() });
                }
            });
        }

        const allFinished = Object.values(room.players).every(p => p.finished);
        if (allFinished) {
            endRound(roomId, 'allFinished');
        } else {
            scheduleSave();
            io.to(roomId).emit('roomUpdate', getCleanRoomData(room));
        }
    });

    // NEW: back navigation without penalizing clicks
    socket.on('goBack', async ({ roomId }) => {
        const room = rooms[roomId];
        const player = room?.players[socket.id];
        if (!room || !player || player.finished) return;
        if (room.status !== 'playing') return;
        if (room.roundEndsAt && Date.now() >= room.roundEndsAt) return;
        if (player.history.length <= 1) return;

        const previousArticle = player.history[player.history.length - 2];
        // Validate the article still loads
        const articleData = await getArticleData(previousArticle);
        if (!articleData) {
            socket.emit('articleNavigationError', {
                message: `Couldn't reload "${previousArticle.replace(/_/g, ' ')}".`,
                failedTargetTitle: previousArticle.replace(/_/g, ' '),
            });
            return;
        }

        // Pop history (remove current), but DO NOT increment clicks or deduct points.
        player.history.pop();
        player.currentArticle = articleData.title.replace(/ /g, '_');

        scheduleSave();
        io.to(roomId).emit('roomUpdate', getCleanRoomData(room));
    });

    // NEW: retry the last failed target without penalizing clicks
    socket.on('retryNavigation', async ({ roomId, targetTitle }) => {
        const room = rooms[roomId];
        const player = room?.players[socket.id];
        if (!room || !player || player.finished) return;
        if (room.status !== 'playing') return;
        if (room.roundEndsAt && Date.now() >= room.roundEndsAt) return;

        const normalizedTarget = targetTitle.replace(/ /g, '_');
        const articleData = await getArticleData(normalizedTarget);

        if (!articleData) {
            socket.emit('articleNavigationError', {
                message: `Still couldn't load "${targetTitle}".`,
                failedTargetTitle: targetTitle,
            });
            return;
        }

        const canonicalTitle = articleData.title.replace(/ /g, '_');
        if (player.currentArticle === canonicalTitle) return;

        // Retry is treated like a normal navigation (it counts as a click because
        // the player is genuinely moving forward), but if the target was the SAME
        // as the current page we bail above.
        player.currentArticle = canonicalTitle;
        player.clicks += 1;
        player.history.push(canonicalTitle);
        player.points -= 10;

        if (articleData.pageid === room.goalPageId) {
            player.finished = true;
            player.time = (Date.now() - room.startTime) / 1000;
            player.points += Math.max(0, 1000 - (player.clicks * 20));
            io.to(roomId).emit('chatMessage', { username: 'System', message: `${player.username} reached the goal in ${player.clicks} clicks!`, timestamp: Date.now() });
        }

        const finishers = Object.values(room.players).filter(p => p.finished && !p.lost);
        if (finishers.length > 0) {
            const bestClicks = Math.min(...finishers.map(p => p.clicks));
            Object.values(room.players).forEach(p => {
                if (!p.finished && p.clicks > bestClicks) {
                    p.finished = true;
                    p.lost = true;
                    io.to(roomId).emit('chatMessage', { username: 'System', message: `${p.username} has been eliminated (too many clicks).`, timestamp: Date.now() });
                }
            });
        }

        const allFinished = Object.values(room.players).every(p => p.finished);
        if (allFinished) {
            endRound(roomId, 'allFinished');
        } else {
            scheduleSave();
            io.to(roomId).emit('roomUpdate', getCleanRoomData(room));
        }
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

    // FIXED: ignore client-supplied username, use the server-side one
    socket.on('chatMessage', ({ roomId, message }) => {
        const room = rooms[roomId];
        const player = room?.players[socket.id];
        if (room && player) {
            const sanitizedMessage = String(message || '').replace(/</g, "&lt;").replace(/>/g, "&gt;").slice(0, 500);
            io.to(roomId).emit('chatMessage', {
                username: player.username,
                message: sanitizedMessage,
                timestamp: Date.now()
            });
        }
    });
});

// FIXED: catch-all for titles containing slashes (e.g. "AC/DC")
app.get('/api/wiki/*', async (req, res) => {
    const title = (req.params[0] || '').split('?')[0];
    if (!title) return res.status(400).json({ error: "Title required" });
    const data = await getArticleData(title);
    if (data) res.json(data);
    else res.status(404).json({ error: "Article not found" });
});

app.get('/api/wiki-summary/*', async (req, res) => {
    const title = (req.params[0] || '').split('?')[0];
    if (!title) return res.status(400).json({ error: "Title required" });
    const data = await getArticleSummary(title);
    if (data) res.json(data);
    else res.status(404).json({ error: "Summary not found" });
});

app.get('/api/wiki-hint/:current/:target', async (req, res) => {
    const hints = await getHint(req.params.current, req.params.target);
    res.json({ hints });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
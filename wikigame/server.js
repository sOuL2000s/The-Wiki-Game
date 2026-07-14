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
        const normalizedGoal = room.goalArticle.replace(/_/g, '_');

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
    else res.status(404).json({ error: "Article not found" });
});

app.get('/api/wiki-summary/:title', async (req, res) => {
    const data = await getArticleSummary(req.params.title);
    if (data) res.json(data);
    else res.status(404).json({ error: "Summary not found" });
});

server.listen(3001, () => console.log('Server running on port 3001'));
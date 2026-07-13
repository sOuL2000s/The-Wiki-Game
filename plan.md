Yes. This is a well-known style of game (often inspired by the "Wiki Game" or "WikiRacing"), and it's very feasible to build. The multiplayer, turn-based aspect makes it even more interesting.

Here's a complete architecture for such a website.

---

# The Game Concept

At the start of each round:

* All players receive the same:

  * Starting article: **"Banana"**
  * Target article: **"Black Hole"**
* Players can only navigate by clicking links inside Wikipedia articles.
* The winner is determined by:

  * Fewest clicks
  * Fastest completion time (tie breaker)

Example:

Start:

```
Banana
```

Goal:

```
Black Hole
```

Player path:

```
Banana
↓
Fruit
↓
Agriculture
↓
Physics
↓
Gravity
↓
Black Hole
```

Score:

```
5 clicks
3 min 42 sec
```

---

# Different Game Modes

## Classic

Random Start

↓

Random Goal

---

## Daily Challenge

Everyone gets the same puzzle every day.

Leaderboards reset daily.

---

## Party Mode

Private room

Friends join

Host starts game

Everyone races simultaneously.

---

## Turn-Based Mode

This sounds like what you're imagining.

Example:

Player A clicks

↓

Player B clicks

↓

Player C clicks

↓

repeat

Every player gets only one move per turn.

That makes strategy much more important.

---

## Elimination

Maximum 30 moves.

If target isn't reached:

Eliminated.

---

## Speed Run

Live timer.

Fastest wins.

---

# Website Structure

```
Homepage

Play

Create Room

Join Room

Leaderboard

Profile

Daily Challenge

Statistics
```

---

# Tech Stack

Frontend

* React
* Next.js
* Tailwind CSS

Backend

* Node.js
* Express
* WebSockets (Socket.IO)

Database

* PostgreSQL

Cache

* Redis

Hosting

* Vercel (frontend)
* Railway / Render / Fly.io (backend)

---

# Database

## Users

```
id

username

password_hash

rating

games_played

wins

best_steps

best_time
```

---

## Games

```
id

host

start_article

goal_article

status

created_at
```

---

## Moves

```
id

game_id

player_id

article

move_number

time
```

---

## Leaderboard

```
user

games

wins

average_steps

average_time
```

---

# Getting Random Wikipedia Pages

Wikipedia provides APIs for this.

Random page:

```
https://en.wikipedia.org/api/rest_v1/page/random/summary
```

Or via the MediaWiki API:

```
https://en.wikipedia.org/w/api.php?action=query&generator=random&grnnamespace=0&format=json
```

---

# Getting Links From an Article

Example:

```
Earth
```

Request:

```
action=parse
&page=Earth
&prop=links
```

Returns every internal Wikipedia link.

---

# Game Logic

Example

```
Start:

Dog

Goal:

Quantum mechanics
```

Player opens

Dog

↓

Clicks

Mammal

↓

Animal

↓

Evolution

↓

Charles Darwin

↓

Science

↓

Physics

↓

Quantum mechanics

Done.

Server records:

```
Dog

Mammal

Animal

Evolution

Charles Darwin

Science

Physics

Quantum mechanics
```

Steps = 7

---

# Multiplayer Logic

Server creates room

```
Room 2837

Players:

Alice

Bob

Charlie
```

Start article

```
Pizza
```

Goal

```
Moon
```

Everyone starts simultaneously.

Server records:

Alice

```
Pizza

Italy

Europe

Earth

Moon
```

4 clicks

Bob

```
Pizza

Cheese

Milk

Cow
...
```

Still playing.

---

# Turn-Based Logic

Instead of racing:

Round 1

Alice

↓

Bob

↓

Charlie

Round 2

Alice

↓

Bob

↓

Charlie

Server validates each move.

---

# Prevent Cheating

Don't let players manually type article URLs.

Instead:

Player clicks

↓

Frontend sends

```
clicked_article_id
```

↓

Server checks

Was that article actually linked from the current article?

If yes:

Accept.

Else:

Reject.

---

# Tracking Steps

Each move:

```
current article

↓

clicked article

↓

+1 step
```

Timer starts when game begins.

Stops at goal.

---

# Difficulty System

Easy

Distance approximately 5–10 clicks

Medium

10–20

Hard

20+

Extreme

Random

You can estimate difficulty using graph algorithms on the Wikipedia link graph, or simply use random pairs and let community ratings refine the difficulty over time.

---

# Ranking System

Every player gets an Elo-like rating.

Example

```
Beginner

1000

Explorer

1200

Scholar

1500

Professor

1800

Wikipedia Wizard

2200
```

---

# Fun Statistics

Profile could show

```
Games played

Average clicks

Fastest win

Longest path

Favorite category

Most visited article

Average thinking time

Current streak

Best streak
```

---

# Cool Features

### Replay

Watch every click after the match.

---

### Path Comparison

See every player's route side by side.

```
Alice

Dog

↓

Animal

↓

Biology

↓

Science

↓

Physics


Bob

Dog

↓

Pet

↓

Human

↓

Civilization

↓

Science

↓

Physics
```

---

### Heat Map

Highlight the most commonly visited articles across all games.

---

### Spectator Mode

Others can watch games live without seeing hidden information (if any game mode requires it).

---

### Chat

Room chat during matches.

---

### Achievements

```
First Win

100 Wins

1000 Articles Visited

Under 5 Clicks

Perfect Game

Night Owl

Explorer

History Buff
```

---

# Scalability

The biggest challenge is Wikipedia traffic and API usage. Instead of fetching article links on every click:

* Cache article metadata and outbound links in your own database or a cache like Redis.
* Periodically refresh cached data if needed.
* Respect Wikipedia's API usage guidelines and identify your application with a proper User-Agent.

This greatly reduces latency and avoids overloading Wikipedia.

---

Overall, this project is very achievable for a solo developer with modern web tools. The core gameplay is straightforward, while the multiplayer layer, rankings, replays, analytics, and caching are where most of the engineering effort lies. A good roadmap is to build it in phases: first a single-player prototype with random start and goal pages, then user accounts and score tracking, then real-time multiplayer rooms, and finally advanced features like replays, rankings, achievements, and daily challenges.

Yes, with some important caveats.

### Is the Wikipedia API free?

Yes. The **MediaWiki API** used by Wikipedia is free to access, and there are no API keys or usage fees for normal use.

Common endpoints include:

* Random article
* Article links
* Search
* Page summaries
* Categories
* Revisions

However:

* You should follow Wikipedia's API etiquette (don't send excessive requests).
* Set a descriptive `User-Agent` for your application.
* Cache responses whenever possible instead of repeatedly requesting the same pages.
* If your game becomes popular (thousands of concurrent users), you should cache article data heavily or consider downloading Wikipedia dumps for your own backend.

---

### Can I just iframe Wikipedia?

**Technically, no.**

Wikipedia sends security headers such as `X-Frame-Options` and `Content-Security-Policy` that prevent its pages from being embedded in iframes on other websites.

If you try:

```html
<iframe src="https://en.wikipedia.org/wiki/Cat"></iframe>
```

the browser will refuse to display it.

So a direct embedded Wikipedia experience is not possible.

---

## How do existing Wikipedia games work?

They generally use one of these approaches.

### Option 1 (Recommended): Build your own Wikipedia reader

Instead of embedding Wikipedia:

1. Fetch the article HTML from the API.
2. Display it inside your own page.
3. Rewrite internal links so they stay inside your app.
4. Ignore or remove navigation, search, edit buttons, etc.

Your page might look like:

```
-----------------------------------
Target:
Black Hole

Current:
Banana

-------------------------------
Banana

A banana is an edible fruit...

...belongs to the Musa genus...

...cultivated in tropical regions...
-------------------------------
```

When the player clicks "Musa", your app loads the next article via the API.

This gives you complete control over:

* counting clicks
* preventing cheating
* multiplayer synchronization
* timers
* UI

---

### Option 2: Open Wikipedia in a new tab

Not recommended.

You lose control over:

* clicks
* timers
* navigation
* cheating

Players can search directly.

---

### Option 3: Download Wikipedia

For very large games.

Run your own copy of Wikipedia data.

Pros:

* instant loading
* no API limits
* scalable

Cons:

* hundreds of GB of storage
* much more infrastructure

Most indie projects don't need this initially.

---

## How do you count clicks?

Suppose the article HTML contains:

```html
<a href="/wiki/Fruit">Fruit</a>
```

Your backend or frontend rewrites it to something like:

```html
<a href="/play/Fruit">Fruit</a>
```

or

```html
<a data-page="Fruit">Fruit</a>
```

Then:

```
Player clicks

↓

JavaScript intercepts

↓

step++

↓

fetch new article

↓

render
```

Every click is under your control.

---

## Can players cheat?

If the client alone tracks moves, yes.

Instead, have the server validate every move:

```
Current page

↓

Player says:
"I clicked Fruit"

↓

Server checks:
Is Fruit actually linked from Banana?

↓

Yes

↓

Move accepted
```

The server remains the source of truth for:

* current article
* move count
* timer
* winner

---

## Would this violate Wikipedia's license?

Generally, you can display Wikipedia content because it's available under a free license, but you need to comply with its attribution requirements. In practice, that means:

* Clearly attribute the content to Wikipedia and its contributors.
* Link back to the original article.
* Preserve required license information where appropriate.

Review the relevant licensing guidance before launching.

---

### My recommendation

Build the game as a **custom Wikipedia browser**, not as an iframe.

Your architecture would be:

```
Browser
    │
    ▼
Your backend
    │
    ├── Game state
    ├── Authentication
    ├── Multiplayer
    ├── Leaderboards
    └── Wikipedia API
```

This gives you a smooth experience, lets you validate moves securely, and avoids the iframe restrictions altogether.


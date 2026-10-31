# Converge

A game of collective intuition for 2–8 players.

Everyone chooses a number. The target depends on the group's average. Your job is to think one step beyond everyone else.

## Playing

1. Create a room and invite friends by link or five-character code.
2. When at least two players are connected, the host starts an eight-round match.
3. Each round gives you 20 seconds to lock an unused whole number from 0 to 100.
4. The target is the average of submitted choices multiplied by the factor shown for that round. Factors cycle through 2/3, 4/3, 0.8, and 1.2. Targets are capped at 100.
5. Score `max(0, round(1000 - 20 × distance from target))`, plus 250 if your guess is closest. Equal closest guesses all receive the bonus.
6. Your first submission is final. You cannot reuse that number during the match. There is no speed bonus.
7. Missed choices score zero. At least two submissions are needed for a round to count. Scores use the full-precision target; the interface displays one decimal place.
8. After eight rounds, the highest score wins. Ties share first place. The host can start a new match with fresh scores and all numbers available again.

Guesses stay hidden until the shared reveal. Players who join mid-match watch until the next match. Refreshing reconnects your player; a disconnected host's controls move to another connected player.

## Run

Requires Node.js 22 or newer. No external server dependencies.

```sh
npm ci
npm start
```

Open http://localhost:3400. For two players on one computer, use different browser profiles or an incognito window. Tabs in the same profile share a session.

Sound begins after the first interaction and can be muted in the header. The choice is remembered. Reduced-motion preferences disable transitions.

The homepage includes a looping gameplay example with sample players. It shows secret choices, the shared reveal, the target calculation, and closest-guess scoring. A pause button stops the preview. It pauses automatically off-screen and displays a still example when reduced motion is enabled. The preview does not create a room or submit real guesses.

## Verify

```sh
npm test
```

## Deploy

Upload the contents of this folder to a new GitHub repository, preserving `public` and `test`. Create a Render Node Web Service:

- Build command: `npm ci`
- Start command: `npm start`
- Root directory: blank
- Health check: `/health`

Free hosting may take time to wake after inactivity. Rooms live in memory and reset when the server restarts. Use one server instance. Fonts load from Google Fonts with local fallbacks.

Built with Node.js, HTML, CSS, and JavaScript. Server-Sent Events synchronize the clients; the server validates submissions, computes targets, and awards points.

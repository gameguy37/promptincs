# Promptin Circumsoftware

"Build a comprehensive web-based teleprompter application designed for live television production. It needs three main pillars: a smooth scrolling engine, a primary/backup network sync, and a rundown dashboard.

Pillar 1: The Smooth Scrolling Engine (Crucial)

The prompter screen must be pitch black with pure white, large, bold sans-serif text.

Do NOT use standard HTML window scrolling. Place the text inside a container div and move it using a requestAnimationFrame loop that updates a hardware-accelerated CSS transform: translateY() value.

Controls: Pressing the Spacebar toggles Play/Pause. Right Arrow increases scroll speed. Left Arrow decreases scroll speed.

Include a subtle red eyeline marker on the left edge.

Pillar 2: Primary & Backup Sync (Supabase Realtime)

Set up Supabase Realtime (Broadcast channels).

Create a toggle switch in the UI for the user to select whether this instance is the 'Host' (Main Mac) or 'Client' (Backup Mac).

When in 'Host' mode, any changes to the scroll speed or Play/Pause state via the keyboard should broadcast instantly to the channel.

When in 'Client' mode, keyboard inputs are disabled, and the scroll engine flawlessly mimics the exact speed and play state received from the 'Host' broadcast.

Pillar 3: The Rundown & Google Docs Bridge

Create a slide-out sidebar menu called 'Rundown'.

In the Rundown, allow me to add new script blocks that can be drag-and-dropped to reorder.

Include a 'Connect Google Doc' button. Set up the frontend UI and the empty backend API route structure required to authenticate with the Google Docs API. For now, when I click 'Sync', just pull in placeholder text, but structure the code so I can easily drop my Google Cloud API credentials in later."

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://promptincs.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/8298a216-29fa-4d56-8c30-52ac4ab3e776).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

# Ping

Reminders and notes for engineers. It runs in your browser and can be installed as an app. There's no account, and your reminders and notes never leave your computer: they're stored in your own browser.

**Open Ping:** https://YOUR-GITHUB-USERNAME.github.io/ping/

## Get started (about 1 minute)
1. Open the link above in **Microsoft Edge**.
2. Install it as an app: click the **App available** icon at the right of the address bar, or **⋯ → Apps → Install Ping**. Ping now has its own window, a Start menu entry and a taskbar icon.
3. To start it at sign-in: open `edge://apps`, click **⋯** on Ping, and turn on **Auto-start on device login**.
4. In Ping, click **Allow notifications**. You'll get a test notification straight away.

Reminders pop up while Ping is running, so **minimise it instead of closing it**. Anything that fell due while it was closed shows up when you open it again.

Always open Ping the same way, in the same browser. Each browser, and each browser profile, keeps its own separate copy of your data.

## Quick add
Type in the big box and press **Enter**. English and Swedish both work.

| You type | You get |
|---|---|
| `Call Anna tomorrow 10:00` | Tomorrow at 10:00 |
| `Stretch in 45 min` / `om 2 timmar kolla mejlen` | Relative times |
| `möte på torsdag kl 13` / `pay rent 25/11` | Days and dates |
| `Deploy check 14:00 UTC` | UTC, converted to your local time |
| `Check pipeline every 30 min` | Repeats every 30 minutes |
| `Standup every weekday kl 9` | Repeats Monday to Friday |
| ``Standup cron `45 8 * * 1-5` `` | Cron schedule |
| `#etl #prod` | Tags (click a tag to filter) |
| `!` `!!` `!!!` or `p1` | Priority: low, medium, high |

**Ctrl+Enter** saves what you typed as a note. Press **?** in Ping to see all keyboard shortcuts.

## Features
- **Alerts:** a Windows notification, a card in the Ping window with Done / Snooze / Edit, and a sound.
- **Outlook:** the **Outlook** button downloads a calendar entry. Open it and click Save & Close, and Outlook reminds you on your phone too.
- **Notes:** written in Markdown, with a preview, code blocks you can copy, `- [ ]` checklists and tables. **Daily log** builds today's standup note from your reminders.
- **Ticket links:** in Settings, add your Jira or Azure DevOps link so IDs like `DATA-123` become clickable.
- **Themes:** Lagoon, Fjord and Solarized, each in light and dark.
- **Your data:** Settings → Your data lets you keep an extra save file on your PC, download a backup, restore one, or export to CSV.

## Moving to a new PC or browser
In the old one: Settings → **Download backup**. In the new one: Settings → **Restore from backup…**.

## For maintainers
Ping is one static `index.html`, plus `manifest.webmanifest`, `sw.js` (offline support) and two icons. There's no build step. Edit `index.html` and push, and everyone gets the update the next time they open Ping.

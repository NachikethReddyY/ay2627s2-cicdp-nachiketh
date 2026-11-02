# Lesson sandbox, editor and chapter generation

Status: decided, not started. Written from the owner's answers in the planning thread.

## Decisions

- **Sandboxes: local Docker now, Daytona later.** Each learner gets their own container. The code talks to a small sandbox interface, so Daytona can replace the Docker backend later without changing the UI.
- **Editor: not VS Code, not code-server.** Keep the existing Monaco editor and make it feel like VS Code's core: file explorer with create, rename and delete; left-click and right-click menus; Command+P quick open; tabs. No extensions. No build or debug commands.
- **Terminal: a real shell** inside the learner's container, shown with xterm.js over a WebSocket. Installing packages and running `python`, `node` and other commands must work.
- **Generation: one chapter at a time.** A chapter is a course. Its subquests are the lessons inside it. The next chapter is generated only when the learner reaches it.
- **Lesson content:** each lesson has its own `instructions.txt`, which is plain text shown in the instructions window.
- **Checks run in the container.** A lesson's check runs its command and compares output or rules. When the check passes, the step is approved automatically.

## Look and feel

- A macOS-style desktop: a menu bar at the top, file icons on the desktop, windows with traffic-light title bars, and a dock.
- Window title bars use Geist Sans bold. Body text stays as it is.
- Opening a file from the desktop opens it in the editor window.
- The menu bar and a Submit button on the right are part of the design; their exact contents are still open (see below).

## Phases

1. **Sandbox service:** a Docker image with bash, Python and Node, one container per learner session, CPU, memory and time limits, idle shutdown, and a WebSocket endpoint that attaches to the shell.
2. **Terminal:** xterm.js in a window, connected to phase 1.
3. **Files and editor:** the lesson's files live in the container; the explorer gets create, rename, delete, context menus and Command+P.
4. **Checks and auto-approval:** run the lesson's check in the container and mark the step done.
5. **Chapter generation:** generate one course at a time with its lessons; generate the next chapter when the current one is complete.

## Open items

- Menu bar contents and the Submit button placement.
- Where the course progress bar goes (the menu bar, or removed).
- The exact file format for a lesson's check rules.

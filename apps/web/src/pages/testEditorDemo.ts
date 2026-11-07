export const DEMO_DIRECTORY = "task-tracker";
export const DEMO_ENTRY_FILE = `${DEMO_DIRECTORY}/web/main.jsx`;

export const DEMO_PROJECT_FILES = [
  {
    path: `${DEMO_DIRECTORY}/README.md`,
    content: `# Tiny Task Tracker

A small command-line task list built with Node.js. It demonstrates functions, arrays, objects, loops, input, and saving data to a JSON file. It uses only Node's built-in modules.

## Start it

    cd task-tracker
    npm start

Try **list**, **add Learn how the app works**, **done 1**, and **remove 2**. Type **help** to see all commands, or **quit** to stop.

Use the **Preview** button in the editor to open its interactive React website.

The app stores tasks in **src/tasks.json**, so they are still there the next time you start it.
`,
  },
  {
    path: `${DEMO_DIRECTORY}/package.json`,
    content: `{
  "name": "tiny-task-tracker",
  "version": "1.0.0",
  "private": true,
  "description": "A beginner-friendly task tracker",
  "type": "module",
  "scripts": {
    "start": "node src/app.js",
    "dev": "vite web --host 0.0.0.0"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "vite": "^6.1.0"
  }
}
`,
  },
  {
    path: `${DEMO_DIRECTORY}/web/index.html`,
    content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Tiny Task Tracker</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.jsx"></script>
  </body>
</html>
`,
  },
  {
    path: `${DEMO_DIRECTORY}/web/main.jsx`,
    content: `import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const starterTasks = [
  { id: 1, title: "Explore the project", completed: false },
  { id: 2, title: "Try completing a task", completed: true },
];

function readTasks() {
  try {
    const saved = localStorage.getItem("tiny-task-tracker.tasks");
    return saved ? JSON.parse(saved) : starterTasks;
  } catch {
    return starterTasks;
  }
}

function App() {
  const [tasks, setTasks] = useState(readTasks);
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    localStorage.setItem("tiny-task-tracker.tasks", JSON.stringify(tasks));
  }, [tasks]);

  const visibleTasks = useMemo(() => tasks.filter((task) => {
    if (filter === "active") return !task.completed;
    if (filter === "done") return task.completed;
    return true;
  }), [filter, tasks]);
  const remaining = tasks.filter((task) => !task.completed).length;

  function addTask(event) {
    event.preventDefault();
    const title = draft.trim();
    if (!title) return;
    setTasks((current) => [...current, { id: Date.now(), title, completed: false }]);
    setDraft("");
  }

  function toggleTask(id) {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, completed: !task.completed } : task));
  }

  function removeTask(id) {
    setTasks((current) => current.filter((task) => task.id !== id));
  }

  return (
    <main className="app-shell">
      <header className="topbar"><span className="brand-mark">✓</span><span>Tiny Task Tracker</span><span className="live-dot" title="App is running" /></header>
      <section className="task-card" aria-labelledby="heading">
        <div className="eyebrow">YOUR WORKSPACE</div>
        <div className="heading-row"><div><h1 id="heading">A little progress<br />goes a long way.</h1><p className="subheading">Keep the next small step in sight.</p></div><div className="count-badge"><strong>{remaining}</strong><span>left</span></div></div>
        <form className="add-form" onSubmit={addTask}>
          <label className="sr-only" htmlFor="new-task">Add a task</label>
          <input id="new-task" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="What needs doing?" />
          <button type="submit">Add task <span aria-hidden="true">↗</span></button>
        </form>
        <div className="list-heading"><h2>My tasks</h2><div className="filters" aria-label="Filter tasks">
          {["all", "active", "done"].map((name) => <button key={name} type="button" className={filter === name ? "filter active-filter" : "filter"} aria-pressed={filter === name} onClick={() => setFilter(name)}>{name === "all" ? "All" : name === "active" ? "To do" : "Done"}</button>)}
        </div></div>
        <ul className="task-list">
          {visibleTasks.map((task) => <li className={task.completed ? "task completed" : "task"} key={task.id}>
            <button type="button" className="check" aria-label={task.completed ? "Mark " + task.title + " active" : "Complete " + task.title} aria-pressed={task.completed} onClick={() => toggleTask(task.id)}>{task.completed ? "✓" : ""}</button>
            <span className="task-title">{task.title}</span>
            <button type="button" className="remove" aria-label={"Remove " + task.title} onClick={() => removeTask(task.id)}>×</button>
          </li>)}
          {visibleTasks.length === 0 && <li className="empty">Nothing here yet. Add a task above.</li>}
        </ul>
        <footer className="card-footer"><span>Small steps count.</span><button type="button" className="clear" onClick={() => setTasks((current) => current.filter((task) => !task.completed))}>Clear completed</button></footer>
      </section>
      <p className="page-note">Changes save in this browser automatically.</p>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
`,
  },
  {
    path: `${DEMO_DIRECTORY}/web/style.css`,
    content: `:root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #20283a; background: #f5f7fb; font-synthesis: none; }
* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; min-height: 100vh; background: radial-gradient(ellipse at 50% -25%, #e5edff 0, transparent 58%), #f5f7fb; }
button, input { font: inherit; } button { cursor: pointer; }
.app-shell { min-height: 100vh; padding: 0 22px 32px; }
.topbar { height: 64px; max-width: 760px; margin: 0 auto; display: flex; align-items: center; gap: 10px; color: #526079; font-size: 13px; font-weight: 650; }
.brand-mark { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 8px; background: #436ee8; color: white; font-weight: 800; }
.live-dot { width: 8px; height: 8px; margin-left: auto; border-radius: 50%; background: #43bf8b; box-shadow: 0 0 0 4px #43bf8b20; }
.task-card { max-width: 620px; margin: 36px auto 0; padding: 38px 42px 24px; border: 1px solid #e4e8f0; border-radius: 24px; background: #fff; box-shadow: 0 18px 55px #263b6510, 0 2px 8px #263b6508; }
.eyebrow { color: #8290a8; font-size: 10px; font-weight: 750; letter-spacing: .13em; }
.heading-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; margin: 12px 0 25px; }
h1 { margin: 0; color: #222d43; font-size: clamp(28px, 5vw, 38px); letter-spacing: -.045em; line-height: 1.12; }
.subheading { margin: 11px 0 0; color: #8490a5; font-size: 13px; }
.count-badge { display: flex; flex-direction: column; align-items: center; min-width: 56px; padding: 9px 10px; border-radius: 15px; background: #eff3ff; color: #4269d9; }
.count-badge strong { font-size: 21px; line-height: 1.1; } .count-badge span { margin-top: 3px; font-size: 10px; }
.add-form { display: flex; gap: 8px; padding: 6px; border: 1px solid #e4e8f0; border-radius: 14px; background: #fafbfe; }
.add-form input { min-width: 0; flex: 1; padding: 10px 12px; border: 0; outline: 0; color: #20283a; background: transparent; font-size: 13px; } .add-form input::placeholder { color: #a0a9b8; }
.add-form button { padding: 0 14px; border: 0; border-radius: 10px; background: #4269e1; color: white; font-size: 12px; font-weight: 650; } .add-form button span { padding-left: 5px; }
.list-heading { display: flex; align-items: center; justify-content: space-between; margin: 29px 0 10px; } .list-heading h2 { margin: 0; font-size: 14px; letter-spacing: -.01em; }
.filters { display: flex; gap: 3px; padding: 3px; border-radius: 10px; background: #f4f6fa; }
.filter { padding: 6px 9px; border: 0; border-radius: 7px; background: transparent; color: #8490a5; font-size: 10px; } .active-filter { background: white; color: #3d5fca; box-shadow: 0 1px 3px #28395c18; }
.task-list { display: grid; gap: 5px; margin: 0; padding: 0; list-style: none; }
.task { display: flex; align-items: center; gap: 11px; min-height: 48px; padding: 6px 8px; border-bottom: 1px solid #f0f2f6; }
.check { display: grid; place-items: center; width: 21px; height: 21px; flex: none; border: 1.5px solid #cbd3e1; border-radius: 7px; background: white; color: white; font-size: 12px; } .completed .check { border-color: #52b991; background: #52b991; }
.task-title { flex: 1; color: #45516a; font-size: 12px; } .completed .task-title { color: #a1a9b7; text-decoration: line-through; }
.remove { width: 28px; height: 28px; border: 0; border-radius: 8px; background: transparent; color: #aab2c0; font-size: 20px; line-height: 1; opacity: 0; } .task:hover .remove, .remove:focus-visible { opacity: 1; } .remove:hover { background: #fff0f0; color: #d45d67; }
.empty { padding: 19px 8px; color: #8b96a8; font-size: 12px; text-align: center; }
.card-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 17px; color: #9aa4b5; font-size: 10px; }
.clear { border: 0; background: transparent; color: #7583a0; font-size: 10px; } .clear:hover { color: #4269e1; }
.page-note { margin: 17px auto; color: #a0a9b8; font-size: 10px; text-align: center; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
@media (max-width: 520px) { .app-shell { padding: 0 12px 24px; } .task-card { margin-top: 16px; padding: 27px 20px 20px; border-radius: 19px; } .heading-row { margin-bottom: 21px; } }
`,
  },
  {
    path: `${DEMO_DIRECTORY}/src/app.js`,
    content: `import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import * as store from "./taskStore.js";

const terminal = createInterface({ input: stdin, output: stdout });

function showHelp() {
  console.log("Commands: list, add <task>, done <id>, remove <id>, help, quit");
}

async function showTasks() {
  const tasks = await store.listTasks();

  if (tasks.length === 0) {
    console.log("Your list is empty. Add a task to get started.");
    return;
  }

  for (const task of tasks) {
    const mark = task.completed ? "✓" : " ";
    console.log("[" + mark + "] " + task.id + ". " + task.title);
  }
}

async function handleCommand(line) {
  const [action, ...words] = line.trim().split(/\\s+/);
  const value = words.join(" ").trim();

  if (!action) return true;

  switch (action.toLowerCase()) {
    case "list":
      await showTasks();
      break;
    case "add": {
      if (!value) {
        console.log("Add a task name, like: add Buy apples");
        break;
      }
      const task = await store.addTask(value);
      console.log("Added task " + task.id + ": " + task.title);
      break;
    }
    case "done": {
      const task = await store.completeTask(Number(value));
      console.log(task ? "Finished: " + task.title : "I couldn't find that task id.");
      break;
    }
    case "remove": {
      const removed = await store.removeTask(Number(value));
      console.log(removed ? "Task removed." : "I couldn't find that task id.");
      break;
    }
    case "help":
      showHelp();
      break;
    case "quit":
    case "exit":
      return false;
    default:
      console.log("I don't know that command. Type help to see the list.");
  }

  return true;
}

async function main() {
  console.log("Tiny Task Tracker — type help for commands.");

  try {
    let keepGoing = true;
    while (keepGoing) {
      const line = await terminal.question("> ");
      keepGoing = await handleCommand(line);
    }
  } finally {
    terminal.close();
  }
}

main().catch((error) => {
  console.error("The task list could not be opened:", error.message);
  process.exitCode = 1;
});
`,
  },
  {
    path: `${DEMO_DIRECTORY}/src/taskStore.js`,
    content: `import { readFile, writeFile } from "node:fs/promises";

const tasksFile = "src/tasks.json";

async function readTasks() {
  const text = await readFile(tasksFile, "utf8");
  return JSON.parse(text);
}

async function saveTasks(tasks) {
  const text = JSON.stringify(tasks, null, 2);
  await writeFile(tasksFile, text + "\\n");
}

async function listTasks() {
  return readTasks();
}

async function addTask(title) {
  const tasks = await readTasks();
  const nextId = tasks.reduce((largest, task) => Math.max(largest, task.id), 0) + 1;
  const task = { id: nextId, title: title.trim(), completed: false };

  tasks.push(task);
  await saveTasks(tasks);
  return task;
}

async function completeTask(id) {
  const tasks = await readTasks();
  const task = tasks.find((item) => item.id === id);

  if (!task) return null;

  task.completed = true;
  await saveTasks(tasks);
  return task;
}

async function removeTask(id) {
  const tasks = await readTasks();
  const remaining = tasks.filter((task) => task.id !== id);

  if (remaining.length === tasks.length) return false;

  await saveTasks(remaining);
  return true;
}

export { listTasks, addTask, completeTask, removeTask };
`,
  },
  {
    path: `${DEMO_DIRECTORY}/src/tasks.json`,
    content: `[
  { "id": 1, "title": "Explore the project", "completed": false },
  { "id": 2, "title": "Try the list command", "completed": true }
]
`,
  },
];

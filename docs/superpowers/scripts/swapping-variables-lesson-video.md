# Teaching video script: swapping and updating variable values

Lesson slug: `swapping-and-updating-variable-values-e6aaad50c34e`. Target length: about 2:48 (392 spoken words at roughly 150 words a minute, plus the pauses). One narrator, calm and friendly, for beginners aged 13 and over.

## Rules this script follows

- **No answer key in the video.** The file is served from `public/`, so anyone can open it. The worked examples use different things (cups, a `score` box, a `name` variable) and never show this lesson's code, its variable names or its three output lines. The swap idea is first asked as a question, the learner is told to pause and predict, and then it is explained with the cups. The learner still has to read the input, convert it, swap, count and print. If you want it less explicit, cut scene 4.
- Plain spoken English, short sentences. Code is described by what it does, not read out symbol by symbol.

## Where the files go

The lesson's Watch tab looks for these files in `apps/web/public/`, using the lesson slug:

| File | What it is | Needed |
|---|---|---|
| `video/<slug>.mp4` | the video, tried first | one of these two |
| `audio/<slug>.mp3` | narration only, used when there is no mp4 | one of these two |
| `video/<slug>.vtt` | captions (CC button and the on-screen caption) | optional |
| `video/<slug>.chapters.vtt` | chapters (marks on the seek bar) | optional |

With no media file the tab shows "The lesson video isn't ready yet."

## Scenes

Times are estimates from the word counts. Replace them with the real times once you have the audio.

| # | Time | Scene | On screen |
|---|---|---|---|
| 1 | 0:00 to 0:08 | Welcome (19 words) | Title card, then three small labels: change, count, swap. |
| 2 | 0:08 to 0:29 | A variable is a box (50 words) | A box labelled score holds 10. A 12 drops in and the 10 fades away. |
| 3 | 0:29 to 0:48 | Predict: two cups (38 words) | Two cups, tea and coffee, with an arrow pouring tea into the coffee cup and a question mark. |
| 4 | 0:48 to 1:22 | Worked example: the spare cup (80 words) | A third, empty cup appears. Three numbered pours, with the contents of each cup shown after every step. |
| 5 | 1:22 to 1:42 | Counting (46 words) | A counter reading 0, then 1, then 2 as a line of code runs twice. |
| 6 | 1:42 to 2:12 | Types (73 words) | The word 42 as text becoming the number 42; two small tags reading number and string. |
| 7 | 2:12 to 2:28 | Printing with backticks (38 words) | A sentence with a blank being filled by a variable named name holding Sam. |
| 8 | 2:28 to 2:48 | Your turn (48 words) | The editor with the starter file, then the Submit button highlighted. |

## Narration (read this to the voice)

**Scene 1: Welcome**
Hi, and welcome back. Today you'll change what a variable holds, count with it, and swap two of them.

**Scene 2: A variable is a box**
A variable is a labelled box, and it holds exactly one value at a time. Here's a box called score. It holds ten. Now we put twelve into the same box. The ten is gone. The computer doesn't keep a copy, and that matters a lot for what comes next.

**Scene 3: Predict: two cups**
Picture two cups. The first holds tea. The second holds coffee. You want to swap them. If you pour the tea straight into the coffee cup, what happens to the coffee? Pause the video and think about it.

**Scene 4: Worked example: the spare cup**
Right: the coffee is gone, just like the ten in our score box. So you need a third, empty cup to hold one drink safely. In code, that's a temporary variable. First, pour the tea into the spare cup. Second, pour the coffee into the first cup. Third, pour the spare cup into the second one. The first cup holds coffee, the second holds tea, and nothing was lost. The order matters. Swap those steps around and a drink disappears.

**Scene 5: Counting**
Next, counting. Start a counter at zero, and each time something happens, add one. In JavaScript, two plus signs after the name do exactly that. Run it once and the counter is one. Run it twice and it's two. You'll use this to count your swaps.

**Scene 6: Types**
Now, types. Anything your program reads from the keyboard arrives as text, even if it looks like a number. To turn text into a number, wrap it in the word Number and brackets. The word typeof tells you what kind of value you're holding. Ask it about forty-two and you get number. Ask it about hello and you get string, the code name for text. It's a handy way to check your work.

**Scene 7: Printing with backticks**
Last idea: printing. To put values inside a sentence, wrap the text in backticks, and put each variable between a dollar sign and curly brackets. If name holds Sam, then hello, name in those brackets prints hello Sam.

**Scene 8: Your turn**
So: read your two values, convert the first, swap them with the spare cup idea, count the swap, and print what the task asks for. Write it in the editor, then press Submit. If you get stuck, ask Sloppy, or press Explain on this video. You've got this.

## Paste-ready text for ElevenLabs

Use this block as is. The `<break>` tags add pauses and work with Multilingual v2 and Turbo. If you use v3, replace each `<break time="0.8s" />` with `[pause]` and the 3-second one with `[long pause]`.

```text
Hi, and welcome back. Today you'll change what a variable holds, count with it, and swap two of them.
<break time="0.8s" />
A variable is a labelled box, and it holds exactly one value at a time. Here's a box called score. It holds ten. Now we put twelve into the same box. The ten is gone. The computer doesn't keep a copy, and that matters a lot for what comes next.
<break time="0.8s" />
Picture two cups. The first holds tea. The second holds coffee. You want to swap them. If you pour the tea straight into the coffee cup, what happens to the coffee?
<break time="3.0s" />
Pause the video and think about it.
<break time="0.8s" />
Right: the coffee is gone, just like the ten in our score box. So you need a third, empty cup to hold one drink safely. In code, that's a temporary variable. First, pour the tea into the spare cup. Second, pour the coffee into the first cup. Third, pour the spare cup into the second one. The first cup holds coffee, the second holds tea, and nothing was lost. The order matters. Swap those steps around and a drink disappears.
<break time="0.8s" />
Next, counting. Start a counter at zero, and each time something happens, add one. In JavaScript, two plus signs after the name do exactly that. Run it once and the counter is one. Run it twice and it's two. You'll use this to count your swaps.
<break time="0.8s" />
Now, types. Anything your program reads from the keyboard arrives as text, even if it looks like a number. To turn text into a number, wrap it in the word Number and brackets. The word typeof tells you what kind of value you're holding. Ask it about forty-two and you get number. Ask it about hello and you get string, the code name for text. It's a handy way to check your work.
<break time="0.8s" />
Last idea: printing. To put values inside a sentence, wrap the text in backticks, and put each variable between a dollar sign and curly brackets. If name holds Sam, then hello, name in those brackets prints hello Sam.
<break time="0.8s" />
So: read your two values, convert the first, swap them with the spare cup idea, count the swap, and print what the task asks for. Write it in the editor, then press Submit. If you get stuck, ask Sloppy, or press Explain on this video. You've got this.
```

## Chapters (for `<slug>.chapters.vtt`)

Set the start times from the real audio. One cue per scene, in this order: Welcome, A variable is a box, Predict: two cups, Worked example: the spare cup, Counting, Types, Printing with backticks, Your turn. Example:

```text
WEBVTT

00:00.000 --> 00:15.000
Welcome

00:15.000 --> 00:39.000
A variable is a box
```

## Suggested voice settings (a starting point, adjust by ear)

- Model: Multilingual v2 (or v3 if you want more expression).
- Stability about 50, similarity about 75, style about 20, speaker boost on.
- Speed 1.0. A warm, mid-pitched voice reads better for beginners than a fast, bright one.
- Generate the whole block at once, then listen to the pause after the cup question: it should be long enough to actually think.

## Check before it ships

- Listen for "typeof" (should sound like "type of") and "backticks".
- Confirm nothing in the final cut shows this lesson's solution code, its variable names (`a`, `b`, `swaps`) or its expected output lines.
- Name the exported files exactly as in "Where the files go".

# HireMatch (ResumeIQ) 🚀

An AI-powered resume analyzer I built to actually understand how ATS scoring works and to help freshers like me figure out why their resume isn't getting shortlisted. Instead of just giving a random score out of 100 like most tools online, this one shows you exactly why you got that score, rule by rule.

Live demo: *(add your deployed link here once it's up)*
Video walkthrough: *(optional, add if you record one)*

---

## Why I built this

Honestly, I got tired of using random "free ATS checkers" online that just say "72% match" with zero explanation and then ask you to pay to see more. As a B.Tech CSE student applying to internships, I wanted something that actually tells me *what to fix*, not just a number to stare at.

So I built my own — with a React frontend, a FastAPI backend, and LangChain + Groq (Llama-3.3-70B) doing the actual analysis. It turned into a much bigger project than I originally planned 😅

---

## What it does

- **ATS Score with full transparency** — scores your resume against 11 explicit rules (keywords, section headings, quantified achievements, formatting, etc.) and shows you the exact points awarded per rule, sorted by biggest point loss first. Not a black box.
- **Honest calibration notes** — if your score is capped for a specific reason (like no verified work experience), it tells you that directly instead of just showing a low number and leaving you confused.
- **Skill gap analysis + a 90-day roadmap** — with a checklist you can actually track, and it doesn't reset every time you refresh the page (learned that the hard way, more on that below).
- **Live job matching** — pulls real, current job postings (via the JSearch API) and scores how well you match each one using AI, not just basic keyword counting. Shows what you're missing per job, not just a percentage.
- **Resume rewrite suggestions** — shows your original line next to the AI's improved version, side by side, so you can accept or reject each one individually. It's also specifically told to never invent fake numbers/metrics — if there's nothing to quantify, it tells you to add a real one instead of making one up.
- **Cover letter generator** — tailored to a specific job description if you paste one in.
- **Interview prep questions** — generated based on your actual projects and tech stack, not generic ones.
- **"Ask about my score" chat** — if you don't understand why you lost points somewhere, you can literally ask it.
- **Everything is saved in your browser** — so refreshing the page doesn't wipe out your analysis or roadmap progress.

---

## Tech Stack

**Frontend:** React, Tailwind CSS, Vite
**Backend:** FastAPI (Python), Pydantic
**AI:** LangChain + Groq (Llama-3.3-70B) — 8 chains running in parallel for speed
**Live Jobs:** JSearch API via RapidAPI
**Storage:** Browser localStorage (no database yet — see Known Issues)

---

## Screenshots

*(Add 3-4 screenshots here — the ATS score breakdown, job matches, and cover letter tab look the best. This is honestly the part that matters most for anyone skimming the repo, so don't skip it.)*

---

## Running it locally

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # on Windows
source venv/bin/activate     # on Mac/Linux
pip install -r requirements.txt
```

Create a `.env` file inside `backend/` (copy `.env.example` and fill in your own keys):

```
GROQ_API_KEY=your_groq_key_here
RAPIDAPI_KEY=your_rapidapi_key_here
ALLOWED_ORIGINS=http://localhost:3000
```

- Get a free Groq API key at [console.groq.com](https://console.groq.com)
- Get a free RapidAPI key at [rapidapi.com](https://rapidapi.com) and subscribe to the **JSearch** API (free tier is enough for testing)

Then run:

```bash
uvicorn app.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000` and upload a resume.

---

## Project Structure

```
resume-analyzer/
├── backend/
│   └── app/
│       ├── main.py              # FastAPI routes
│       ├── chains.py            # all the LangChain/Groq prompts
│       ├── models.py            # Pydantic schemas
│       ├── calibration.py       # score calibration/transparency logic
│       ├── ats_rules_config.py  # the 11 ATS scoring rules, versioned
│       ├── extractor.py         # PDF/DOCX text extraction
│       └── feedback.py          # logs thumbs up/down feedback
└── frontend/
    └── src/
        ├── components/
        │   └── panels/          # ATS score, job matches, cover letter, etc.
        ├── api/client.js
        └── utils/storage.js     # localStorage persistence
```

---

## Things I learned building this

- LLMs don't always follow instructions perfectly — I had a bug where the cover letter generation kept failing because the model returned actual line breaks inside a JSON string instead of `\n`, which broke `JSON.parse()`. Had to write a small sanitizer for that.
- RapidAPI's JSearch endpoint changed from `/search` to `/search-v2` at some point and I had no idea until I actually went and checked their live docs instead of assuming my old code was still correct — good reminder that third-party APIs change and you can't just trust old code forever.
- Async/await in FastAPI + running 7-8 LLM calls in parallel taught me a lot about `asyncio.gather` and handling partial failures gracefully (if one chain fails, the rest of the app shouldn't break).
- CORS errors are annoying but almost always just mean your frontend and backend ports don't match what's in your allow-list. Took me way too long to debug this the first time.

---

## Known issues / what I'd add next

- No user accounts yet — everything is stored per-browser, so it doesn't sync across devices. A real database + login is the next big thing I want to add.
- No automated tests yet (I know, I know — it's on my list).
- The AI is instructed to be quite strict with ATS scoring (similar to real recruiter screening), so don't be surprised if your first score feels harsh — that's intentional, not a bug.

---

## Contact

Built by Astha — B.Tech CSE student.
Feel free to reach out or open an issue if you find bugs (there are probably a few 🙂)

# Backend Dockerfile — FastAPI + LangChain/Groq resume analyzer API
FROM python:3.11-slim

WORKDIR /app

# Install dependencies first (separate layer) so Docker can cache this step
# and skip re-installing every time only app code changes, not requirements.txt.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Now copy the actual application code
COPY app ./app

# App Runner (and most container platforms) expect the app to listen on
# whatever port they inject via $PORT; default to 8080 for local `docker run`.
ENV PORT=8080
EXPOSE 8080

# Uses shell form so $PORT expands correctly at container start time.
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
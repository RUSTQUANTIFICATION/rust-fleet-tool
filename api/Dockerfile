FROM python:3.10-slim

WORKDIR /app

# 👇 IMPORTANT (ADD THIS LINE)
ENV PYTHONPATH=/app

COPY requirements.txt .

RUN pip install --upgrade pip setuptools wheel
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 10000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "10000"]
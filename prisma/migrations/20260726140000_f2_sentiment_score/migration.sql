-- F2: Sentiment as a first-class module.
-- Per-response 0–100 sentiment score (the coarse `brand_sentiment` label stays for
-- back-compat and is derived from the score). Null when the brand isn't mentioned.
-- The daily aggregate lives in visibility_daily.sentiment_score (added in F1).

alter table public.responses
  add column if not exists brand_sentiment_score int;

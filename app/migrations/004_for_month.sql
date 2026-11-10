-- Which calendar month a recurring payment is for (NULL = derive automatically from the date)
ALTER TABLE expenses ADD COLUMN for_month TEXT CHECK (for_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

-- Integration tests refuse any database whose name lacks "test", so they get
-- their own. POSTGRES_DB (set in compose.yaml) is the development database.
CREATE DATABASE vml_test;

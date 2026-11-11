-- 0002_skill_domain_operations.sql — Add the operations domain for
-- operations-focused skills (e.g. GrokBotHub playbooks).

ALTER TYPE skill_domain ADD VALUE IF NOT EXISTS 'operations';

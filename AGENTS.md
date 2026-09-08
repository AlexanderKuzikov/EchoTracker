# EchoTracker — Instructions for AI Agents

## Commands

- install: `pnpm install` (только по явной просьбе пользователя)
- dev: `pnpm dev` (api + web в watch)
- test: `pnpm test`
- build: `pnpm build`
- typecheck: `pnpm typecheck`

## Conventions

- Стек: React 19 thin (без гридов и форм-библиотек) + Node + SQLite, Caddy с LE
- Одна копия — один проект, project_id в базе нет
- Оригинал docx неприкосновенен, md — производная и пересоздаётся
- Файлы на диске под uuid, в базе только мета; отдача только через API с проверкой прав
- Уведомления через порт Notifier, первый адаптер Email
- Коммиты повелительным наклонением, заголовок до 72 символов, без точки в конце
- Коммиты прямо в `main`, без веток и PR; коммитить и пушить только по явной просьбе
- Surgical changes: трогать только нужное, совпадать со стилем

## Structure

```
EchoTracker/
├── README.md
├── AGENTS.md
├── docs/
│   ├── CONTEXT.md
│   └── DECISIONS.md
├── .env.example   # шаблон конфига, секретов нет
└── (код позже: api/ + web/ + data/ вне git)
```

## Do NOT touch

- `.git/` руками; никакого `push --force` и `reset --hard` без подтверждения
- Чужие проекты в `D:\GitHub\` без явной просьбы
- `node_modules/`, `dist/`, `data/`, `uploads/` — не коммитить
- Внешние сервисы, недоступные из РФ без VPN, — не закладывать

## Documentation rules

- После работы — обнови docs/CONTEXT.md
- Если принял архитектурное решение — запиши в docs/DECISIONS.md
- НЕ создавай новых файлов документации без разрешения
- Переиспользуемые знания — в D:\GitHub\knowledge/README.md

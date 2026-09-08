# EchoTracker — Instructions for AI Agents

## Commands

- dev: `pnpm dev` (одна команда: api + web под /echo, порты с автоподбором, Ctrl+C гасит всё)
- install: `pnpm install` (только по явной просьбе пользователя)
- test: `pnpm test`
- build: `pnpm build`
- typecheck: `pnpm typecheck`

## Conventions

- Стек: React 19 thin (без гридов и форм-библиотек) + Node + SQLite, Caddy с LE
- Живёт в репо проекта в `echo/`, отдаётся с сабпата `ECHO_BASE` (дефолт /echo/); project_id в базе нет
- Доки проекта читаются живьём из `../../docs` + `README.md` проекта, трекер их никогда не пишет
- Оригинал docx неприкосновенен, md — производная и пересоздаётся
- Файлы на диске под uuid, в базе только мета; отдача только через API с проверкой прав
- Производные привязаны к родителю (derived_from), удаление каскадом с чисткой диска
- Уведомления через порт Notifier, первый адаптер Email
- Коммиты повелительным наклонением, заголовок до 72 символов, без точки в конце
- Коммиты прямо в `main`, без веток и PR; коммитить и пушить только по явной просьбе
- Surgical changes: трогать только нужное, совпадать со стилем

## Structure

```
EchoTracker/              # апстрим; в проект ложится как echo/ через scripts/adopt.ps1
├── README.md
├── AGENTS.md
├── docs/
│   ├── CONTEXT.md
│   └── DECISIONS.md
├── api/src/         # zero-dep TS: server, db, auth, email (запуск без сборки)
├── web/src/         # тонкий React: доска, календарь, документы, модалка, производные
├── scripts/dev.mjs  # dev api+web
├── scripts/adopt.ps1  # встройка копии в проект
├── .env.example   # шаблон конфига, секретов нет
└── data/ uploads/   # вне git
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

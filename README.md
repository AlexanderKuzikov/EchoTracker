<p align="center">
  <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white"> <img alt="SQLite" src="https://img.shields.io/badge/SQLite-3-003B57?logo=sqlite&logoColor=white"> <img alt="License" src="https://img.shields.io/badge/License-MIT-blue.svg">
</p>

<h1 align="center">EchoTracker</h1>
<p align="center">Одна доска на проект: свои задачи, ожидание заказчика, файлы с md-предпросмотром</p>

---

Свой канбан для соло-разработки. Одна копия — один проект: данные не смешиваются, бэкап — копией папки, удаление — сносом папки. Никаких внешних сервисов: крутится на своём сервере за Caddy.

Карточек два типа: своя задача со сроком и запрос заказчику с датой и счётчиком дней ожидания. Файлы прикладывает любой участник, docx хранится оригиналом, рядом лежит md-производная для чтения и автоматизации.

- **Одна доска на проект** — копия репозитория, без мультитенантности
- **Ожидание заказчика** — дата запроса, дней в ожидании, подсветка залежей
- **Свои задачи со сроками** — WIP-лимит 1-2 под соло-режим
- **Файлы от любого участника** — картинки и pdf внутри, docx скачать + md рядом
- **Уведомления по email** — назначение, срок, залежавшееся ожидание
- **Свой сервер** — без сервисов, недоступных из РФ без VPN

## Быстрый старт

```bash
git clone https://github.com/AlexanderKuzikov/EchoTracker.git
cd EchoTracker
cp .env.example .env
pnpm install
pnpm dev   # api 127.0.0.1:8100 + web 127.0.0.1:5174 (занят — подберёт свободный)
```

## Документация

- [`docs/CONTEXT.md`](docs/CONTEXT.md) — состояние проекта
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — архитектурные решения

## Статус

**v0.1.0** — Скелет репозитория и документации, кода доски пока нет.

## Лицензия

[MIT](LICENSE) © Alexander Kuzikov

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class Article:
    id: str
    platform: str
    title: str
    url: str
    published_at: str
    metrics: dict[str, int]


@dataclass(frozen=True)
class Comment:
    id: str
    article_id: str
    author: str
    text: str
    created_at: str


@dataclass(frozen=True)
class Topic:
    platform: str
    name: str
    score: float
    captured_at: str


class SocialDataSource(Protocol):
    """Stable interface every connector must implement.

    The governance plane and the Builder Runtime depend on this Protocol,
    never on a concrete vendor SDK. Swapping RedFox for OneAPI must not
    require changes outside this package.
    """

    platform: str

    def search_articles(self, query: str, limit: int = 20) -> list[Article]:
        ...

    def get_article_detail(self, article_id: str) -> Article:
        ...

    def get_comments(self, article_id: str, limit: int = 50) -> list[Comment]:
        ...

    def get_top_topics(self, limit: int = 10) -> list[Topic]:
        ...

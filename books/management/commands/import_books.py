"""
management command: import_books

Open Library API에서 실제 도서 데이터를 가져와 DB에 적재합니다.
키 불필요, 완전 무료.

사용법:
  python manage.py import_books                  # 기본 20권 (인기 주제)
  python manage.py import_books --subjects 소설 시 역사 --limit 50
  python manage.py import_books --query "파이썬" --limit 20
"""

import json
import time

import requests
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from books.models import Author, Book, Genre


SUBJECT_MAP = {
    # Open Library subject → 한국어 장르명
    "fiction": "소설",
    "science fiction": "SF",
    "fantasy": "판타지",
    "mystery": "미스터리",
    "biography": "전기",
    "history": "역사",
    "self-help": "자기계발",
    "philosophy": "철학",
    "science": "과학",
    "poetry": "시",
    "romance": "로맨스",
    "thriller": "스릴러",
    "children": "어린이",
    "technology": "기술",
    "art": "예술",
    "psychology": "심리학",
    "economics": "경제",
    "computer science": "컴퓨터",
}

DEFAULT_SUBJECTS = [
    "fiction", "science fiction", "mystery", "history",
    "biography", "philosophy", "self-help", "science",
    "fantasy", "thriller", "psychology", "economics",
]


class Command(BaseCommand):
    help = "Open Library API에서 도서 데이터를 수집해 DB에 적재합니다"

    def add_arguments(self, parser):
        parser.add_argument(
            "--subjects", nargs="*",
            default=None,
            help="수집할 Open Library subject 목록 (예: fiction mystery)",
        )
        parser.add_argument(
            "--query", type=str, default=None,
            help="자유 검색어로 수집 (--subjects와 병용 가능)",
        )
        parser.add_argument(
            "--limit", type=int, default=20,
            help="총 수집 목표 건수 (기본 20)",
        )
        parser.add_argument(
            "--skip-existing", action="store_true",
            help="이미 존재하는 ISBN은 건너뜀",
        )

    def handle(self, *args, **options):
        limit = options["limit"]
        subjects = options["subjects"] or DEFAULT_SUBJECTS
        query = options["query"]
        skip_existing = options["skip_existing"]

        self.stdout.write(f"📚 도서 수집 시작 — 목표 {limit}권")

        created_total = 0
        skipped_total = 0

        # 쿼리 방식
        if query:
            created, skipped = self._fetch_by_query(query, limit, skip_existing)
            created_total += created
            skipped_total += skipped

        # 주제별 방식
        per_subject = max(1, limit // len(subjects))
        for subject in subjects:
            if created_total >= limit:
                break
            remaining = limit - created_total
            fetch_n = min(per_subject, remaining)
            created, skipped = self._fetch_by_subject(subject, fetch_n, skip_existing)
            created_total += created
            skipped_total += skipped
            time.sleep(0.5)  # API 레이트리밋 회피

        self.stdout.write(
            self.style.SUCCESS(
                f"✅ 완료 — 생성: {created_total}권, 건너뜀: {skipped_total}권"
            )
        )

        # TF-IDF 벡터 재계산 트리거
        if created_total > 0:
            self.stdout.write("📐 TF-IDF 벡터 재계산 중...")
            from recommendations.engine import recompute_all_tfidf_vectors
            recompute_all_tfidf_vectors()
            self.stdout.write(self.style.SUCCESS("✅ TF-IDF 벡터 갱신 완료"))

    # ── 주제별 수집 ───────────────────────────────────────────────────
    def _fetch_by_subject(self, subject: str, limit: int, skip_existing: bool):
        url = "https://openlibrary.org/search.json"
        params = {
            "subject": subject,
            "limit": limit,
            "fields": "key,title,author_name,isbn,cover_i,subject,publisher,first_publish_year,number_of_pages_median",
            "sort": "rating",
        }
        try:
            resp = requests.get(url, params=params, timeout=10)
            resp.raise_for_status()
            docs = resp.json().get("docs", [])
        except Exception as e:
            self.stderr.write(f"  ⚠ subject={subject} 수집 실패: {e}")
            return 0, 0

        genre_name = SUBJECT_MAP.get(subject.lower(), subject)
        genre_obj, _ = Genre.objects.get_or_create(name=genre_name)

        return self._save_docs(docs, genre_obj, skip_existing, label=subject)

    # ── 쿼리 검색 수집 ───────────────────────────────────────────────
    def _fetch_by_query(self, query: str, limit: int, skip_existing: bool):
        url = "https://openlibrary.org/search.json"
        params = {
            "q": query,
            "limit": limit,
            "fields": "key,title,author_name,isbn,cover_i,subject,publisher,first_publish_year,number_of_pages_median",
        }
        try:
            resp = requests.get(url, params=params, timeout=10)
            resp.raise_for_status()
            docs = resp.json().get("docs", [])
        except Exception as e:
            self.stderr.write(f"  ⚠ 쿼리 검색 실패: {e}")
            return 0, 0

        return self._save_docs(docs, None, skip_existing, label=f"query:{query}")

    # ── 공통 저장 ────────────────────────────────────────────────────
    def _save_docs(self, docs, default_genre, skip_existing, label=""):
        created = 0
        skipped = 0

        for item in docs:
            if not item.get("title"):
                continue

            # ISBN 결정 (13자리 우선)
            raw_isbns = item.get("isbn") or []
            isbn13 = next((i for i in raw_isbns if len(i) == 13), None)
            isbn10 = next((i for i in raw_isbns if len(i) == 10), None)
            isbn = isbn13 or isbn10

            # 중복 확인
            if isbn and Book.objects.filter(isbn=isbn).exists():
                if skip_existing:
                    skipped += 1
                    continue
                # ISBN이 이미 있어도 장르 추가는 함
                book = Book.objects.get(isbn=isbn)
                if default_genre:
                    book.genres.add(default_genre)
                skipped += 1
                continue

            # 저자 처리
            author_names = item.get("author_name") or []
            author_objs = []
            for name in author_names[:3]:
                a, _ = Author.objects.get_or_create(name=name.strip())
                author_objs.append(a)

            # 표지 URL
            cover_id = item.get("cover_i")
            cover_url = f"https://covers.openlibrary.org/b/id/{cover_id}-M.jpg" if cover_id else ""

            # Open Library 워크 URL (상세 정보 key)
            ol_key = item.get("key", "")

            book = Book.objects.create(
                isbn=isbn,
                title=item["title"][:500],
                cover_url=cover_url,
                published_year=item.get("first_publish_year"),
                pages=item.get("number_of_pages_median"),
                publisher=(item.get("publisher") or [""])[0][:200],
                language="en",
                source="open_library",
                external_id=ol_key,
                tfidf_vector_json="{}",
            )
            book.authors.set(author_objs)
            if default_genre:
                book.genres.add(default_genre)

            # Open Library subjects → 추가 장르 매핑
            raw_subjects = item.get("subject") or []
            for subj in raw_subjects[:10]:
                mapped = SUBJECT_MAP.get(subj.lower())
                if mapped:
                    g, _ = Genre.objects.get_or_create(name=mapped)
                    book.genres.add(g)

            created += 1
            self.stdout.write(f"  + [{label}] {book.title[:60]}")

        return created, skipped

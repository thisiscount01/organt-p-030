"""
management command: seed_categories

커뮤니티 카테고리와 기본 장르를 초기화합니다.
python manage.py seed_categories
"""

from django.core.management.base import BaseCommand
from books.models import Genre
from community.models import Category


GENRES = [
    "소설", "SF", "판타지", "미스터리", "역사", "전기",
    "자기계발", "철학", "과학", "시", "로맨스", "스릴러",
    "어린이", "기술", "예술", "심리학", "경제", "컴퓨터",
]

CATEGORIES = [
    {"name": "도서 리뷰", "slug": "review", "order": 1, "description": "읽은 책에 대한 리뷰를 공유해요"},
    {"name": "추천 도서", "slug": "recommend", "order": 2, "description": "다른 사람에게 책을 추천해요"},
    {"name": "독서 토론", "slug": "discussion", "order": 3, "description": "책에 대해 자유롭게 토론해요"},
    {"name": "자유 게시판", "slug": "free", "order": 4, "description": "독서와 관련된 자유로운 이야기"},
    {"name": "공지사항", "slug": "notice", "order": 0, "description": "BookWise 공지사항"},
]


class Command(BaseCommand):
    help = "커뮤니티 카테고리와 도서 장르 초기 데이터를 적재합니다"

    def handle(self, *args, **options):
        # 장르
        genre_created = 0
        for name in GENRES:
            _, created = Genre.objects.get_or_create(name=name)
            if created:
                genre_created += 1
        self.stdout.write(f"장르: {genre_created}개 생성")

        # 카테고리
        cat_created = 0
        for cat_data in CATEGORIES:
            _, created = Category.objects.get_or_create(
                slug=cat_data["slug"],
                defaults={
                    "name": cat_data["name"],
                    "description": cat_data["description"],
                    "order": cat_data["order"],
                },
            )
            if created:
                cat_created += 1
        self.stdout.write(
            self.style.SUCCESS(f"카테고리: {cat_created}개 생성 — 초기화 완료")
        )

#!/bin/bash
# BookWise — 초기 환경 셋업 스크립트
# 사용법: bash setup.sh

set -e

echo "📦 패키지 설치..."
pip install -r requirements.txt

echo "🗄️  마이그레이션 생성..."
python manage.py makemigrations accounts books community recommendations

echo "🗄️  마이그레이션 적용..."
python manage.py migrate

echo "🌱 초기 데이터 (장르·카테고리) 적재..."
python manage.py seed_categories

echo "📚 Open Library에서 도서 데이터 수집 (약 40권)..."
python manage.py import_books --limit 40

echo "👤 슈퍼유저 생성 (필요 시)..."
echo "  python manage.py createsuperuser"

echo ""
echo "✅ 셋업 완료! 서버 시작:"
echo "  python manage.py runserver"

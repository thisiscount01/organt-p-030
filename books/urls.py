"""books — URL patterns"""

from django.urls import path
from . import views

urlpatterns = [
    path("", views.book_list, name="book-list"),
    path("<int:pk>/", views.book_detail, name="book-detail"),
    path("<int:pk>/interact/", views.book_interact, name="book-interact"),
    path("genres/", views.genre_list, name="genre-list"),
    path("external/search/", views.external_book_search, name="external-book-search"),
]

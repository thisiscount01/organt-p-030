"""recommendations — URL patterns"""

from django.urls import path
from . import views

urlpatterns = [
    path("", views.personalized, name="rec-personalized"),
    path("popular/", views.popular, name="rec-popular"),
    path("similar/<int:pk>/", views.similar_books, name="rec-similar"),
    path("history/", views.recommendation_history, name="rec-history"),
]

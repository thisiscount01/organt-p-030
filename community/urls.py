"""community — URL patterns"""

from django.urls import path
from . import views

urlpatterns = [
    path("categories/", views.category_list, name="community-categories"),
    path("posts/", views.post_list, name="community-post-list"),
    path("posts/<int:pk>/", views.post_detail, name="community-post-detail"),
    path("posts/<int:pk>/like/", views.post_like, name="community-post-like"),
    path("posts/<int:post_pk>/comments/", views.comment_list, name="community-comment-list"),
    path("posts/<int:post_pk>/comments/<int:comment_pk>/", views.comment_detail, name="community-comment-detail"),
    path("posts/<int:post_pk>/comments/<int:comment_pk>/like/", views.comment_like, name="community-comment-like"),
]

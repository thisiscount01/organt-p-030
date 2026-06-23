"""accounts — URL patterns"""

from django.urls import path
from . import views

urlpatterns = [
    path("register/", views.register, name="auth-register"),
    path("login/", views.login, name="auth-login"),
    path("logout/", views.logout, name="auth-logout"),
    path("me/", views.my_profile, name="auth-me"),
    path("users/<int:pk>/", views.user_profile, name="auth-user-profile"),
]

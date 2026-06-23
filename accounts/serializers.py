"""accounts — Serializers"""

from django.contrib.auth import authenticate
from rest_framework import serializers
from .models import CustomUser


class UserRegistrationSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)
    password_confirm = serializers.CharField(write_only=True)

    class Meta:
        model = CustomUser
        fields = ["username", "email", "password", "password_confirm"]

    def validate(self, data):
        if data["password"] != data["password_confirm"]:
            raise serializers.ValidationError({"password_confirm": "비밀번호가 일치하지 않습니다."})
        return data

    def create(self, validated_data):
        validated_data.pop("password_confirm")
        password = validated_data.pop("password")
        user = CustomUser(**validated_data)
        user.set_password(password)
        user.save()
        return user


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(write_only=True)

    def validate(self, data):
        user = authenticate(username=data["username"], password=data["password"])
        if not user:
            raise serializers.ValidationError("아이디 또는 비밀번호가 올바르지 않습니다.")
        if not user.is_active:
            raise serializers.ValidationError("비활성화된 계정입니다.")
        data["user"] = user
        return data


class UserProfileSerializer(serializers.ModelSerializer):
    avatar_url = serializers.ReadOnlyField()
    favorite_genres = serializers.StringRelatedField(many=True, read_only=True)
    # 읽기 통계 (annotation으로 주입)
    read_count = serializers.IntegerField(read_only=True, default=0)
    post_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = CustomUser
        fields = [
            "id", "username", "email", "bio", "avatar_url",
            "favorite_genres", "read_count", "post_count",
            "date_joined",
        ]
        read_only_fields = ["id", "username", "date_joined"]


class UserProfileUpdateSerializer(serializers.ModelSerializer):
    favorite_genre_ids = serializers.ListField(
        child=serializers.IntegerField(), write_only=True, required=False
    )

    class Meta:
        model = CustomUser
        fields = ["bio", "avatar", "favorite_genre_ids"]

    def update(self, instance, validated_data):
        genre_ids = validated_data.pop("favorite_genre_ids", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if genre_ids is not None:
            instance.favorite_genres.set(genre_ids)
        return instance


class UserMiniSerializer(serializers.ModelSerializer):
    avatar_url = serializers.ReadOnlyField()

    class Meta:
        model = CustomUser
        fields = ["id", "username", "avatar_url"]

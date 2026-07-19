from rest_framework import serializers


class UuidModelSerializer(serializers.ModelSerializer):
    """Base serializer: expose the UUID as `id`, never the integer PK."""

    id = serializers.UUIDField(source="uuid", read_only=True)


class UuidRelatedField(serializers.SlugRelatedField):
    """FK reference by public UUID (write `"rider": "<uuid>"`)."""

    def __init__(self, **kwargs):
        kwargs.setdefault("slug_field", "uuid")
        super().__init__(**kwargs)

    def to_representation(self, obj):
        return str(obj.uuid)

"""Zone request schemas."""

from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator

VALID_ZONE_TYPES = ("RECEIVING", "STORAGE", "PICKING", "STAGING", "SHIPPING")


class CreateZoneRequest(BaseModel):
    warehouse_id: int = Field(..., gt=0)
    zone_code: str = Field(..., min_length=1, max_length=32)
    zone_name: str = Field(..., min_length=1, max_length=128)
    zone_type: str = Field(..., min_length=1, max_length=32)

    @field_validator("zone_type")
    @classmethod
    def validate_zone_type(cls, v: str) -> str:
        if v not in VALID_ZONE_TYPES:
            raise ValueError(f"zone_type must be one of: {', '.join(VALID_ZONE_TYPES)}")
        return v


class UpdateZoneRequest(BaseModel):
    zone_code: Optional[str] = Field(None, min_length=1, max_length=32)
    zone_name: Optional[str] = Field(None, min_length=1, max_length=128)
    zone_type: Optional[str] = Field(None, min_length=1, max_length=32)
    is_active: Optional[bool] = None

    @field_validator("zone_type")
    @classmethod
    def validate_zone_type(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_ZONE_TYPES:
            raise ValueError(f"zone_type must be one of: {', '.join(VALID_ZONE_TYPES)}")
        return v


class WarehouseAreaRequest(BaseModel):
    zone_code: str = Field(..., min_length=1, max_length=32)
    zone_name: str = Field(..., min_length=1, max_length=128)
    zone_type: str = Field(..., min_length=1, max_length=32)

    @field_validator("zone_code", mode="before")
    @classmethod
    def normalize_code(cls, value) -> str:
        return str(value or "").strip().upper()

    @field_validator("zone_name", mode="before")
    @classmethod
    def normalize_name(cls, value) -> str:
        return str(value or "").strip()

    @field_validator("zone_type")
    @classmethod
    def validate_zone_type(cls, value: str) -> str:
        if value not in VALID_ZONE_TYPES:
            raise ValueError(f"zone_type must be one of: {', '.join(VALID_ZONE_TYPES)}")
        return value


class SetupWarehouseAreasRequest(BaseModel):
    warehouse_id: int = Field(..., gt=0)
    zones: list[WarehouseAreaRequest] = Field(..., min_length=4, max_length=4)

    @model_validator(mode="after")
    def validate_unique_codes(self):
        codes = [zone.zone_code for zone in self.zones]
        if len(set(codes)) != len(codes):
            raise ValueError("zone_code values must be unique")
        return self

"""Bin request schemas."""

from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator

VALID_BIN_TYPES = ("Staging", "PickableStaging", "Pickable")


class CreateBinRequest(BaseModel):
    zone_id: int = Field(..., gt=0)
    warehouse_id: int = Field(..., gt=0)
    bin_code: str = Field(..., min_length=1, max_length=64)
    bin_barcode: str = Field(..., min_length=1, max_length=128)
    bin_type: str = Field(..., min_length=1, max_length=32)
    aisle: Optional[str] = Field(None, max_length=32)
    # PostgreSQL stores these physical coordinates as VARCHAR(10). Some
    # warehouses use letters (for example Autosav rows a-f), so validating
    # them as integers rejected values the database was explicitly designed
    # to retain.
    row_num: Optional[str] = Field(None, max_length=10)
    level_num: Optional[str] = Field(None, max_length=10)
    position_num: Optional[str] = Field(None, max_length=10)
    pick_sequence: int = Field(0, ge=0)
    putaway_sequence: int = Field(0, ge=0)

    @field_validator("row_num", "level_num", "position_num", mode="before")
    @classmethod
    def normalize_coordinates(cls, value):
        if value is None or value == "":
            return None
        return str(value).strip()

    @field_validator("bin_type")
    @classmethod
    def validate_bin_type(cls, v: str) -> str:
        if v not in VALID_BIN_TYPES:
            raise ValueError(f"bin_type must be one of: {', '.join(VALID_BIN_TYPES)}")
        return v


class UpdateBinRequest(BaseModel):
    bin_code: Optional[str] = Field(None, min_length=1, max_length=64)
    bin_barcode: Optional[str] = Field(None, max_length=128)
    bin_type: Optional[str] = Field(None, min_length=1, max_length=32)
    aisle: Optional[str] = Field(None, max_length=32)
    row_num: Optional[str] = Field(None, max_length=10)
    level_num: Optional[str] = Field(None, max_length=10)
    position_num: Optional[str] = Field(None, max_length=10)
    pick_sequence: Optional[int] = Field(None, ge=0)
    putaway_sequence: Optional[int] = Field(None, ge=0)
    is_active: Optional[bool] = None
    zone_id: Optional[int] = Field(None, gt=0)

    @field_validator("row_num", "level_num", "position_num", mode="before")
    @classmethod
    def normalize_coordinates(cls, value):
        if value is None or value == "":
            return None
        return str(value).strip()

    @field_validator("bin_type")
    @classmethod
    def validate_bin_type(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_BIN_TYPES:
            raise ValueError(f"bin_type must be one of: {', '.join(VALID_BIN_TYPES)}")
        return v


class GenerateBinsRequest(BaseModel):
    """Generate a rectangular warehouse layout in one transaction."""

    zone_id: int = Field(..., gt=0)
    warehouse_id: int = Field(..., gt=0)
    aisles: list[str] = Field(..., min_length=1, max_length=50)
    rows: list[str] = Field(..., min_length=1, max_length=50)
    position_from: int = Field(..., ge=1, le=9999)
    position_to: int = Field(..., ge=1, le=9999)
    level_num: Optional[str] = Field(None, max_length=10)
    bin_type: str = Field("Pickable", min_length=1, max_length=32)
    sequence_start: int = Field(1, ge=0)

    @field_validator("aisles", "rows")
    @classmethod
    def normalize_coordinates(cls, values: list[str]) -> list[str]:
        cleaned = list(dict.fromkeys(str(value).strip() for value in values if str(value).strip()))
        if not cleaned:
            raise ValueError("at least one value is required")
        if any(len(value) > 10 for value in cleaned):
            raise ValueError("coordinate values must have at most 10 characters")
        if any(not all(char.isalnum() or char in "._/" for char in value) for value in cleaned):
            raise ValueError("coordinate values may contain only letters, digits, dot, underscore, or slash")
        return cleaned

    @field_validator("level_num", mode="before")
    @classmethod
    def normalize_level(cls, value):
        return str(value).strip() if value not in (None, "") else None

    @field_validator("bin_type")
    @classmethod
    def validate_bin_type(cls, value: str) -> str:
        if value not in VALID_BIN_TYPES:
            raise ValueError(f"bin_type must be one of: {', '.join(VALID_BIN_TYPES)}")
        return value

    @model_validator(mode="after")
    def validate_range(self):
        if self.position_to < self.position_from:
            raise ValueError("position_to must be greater than or equal to position_from")
        count = len(self.aisles) * len(self.rows) * (self.position_to - self.position_from + 1)
        if count > 5000:
            raise ValueError("a batch may generate at most 5000 locations")
        return self

"""Bin request schemas."""

from typing import Optional

from pydantic import BaseModel, Field, field_validator

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

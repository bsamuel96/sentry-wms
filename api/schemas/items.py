"""Item request schemas."""

from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class CreateItemRequest(BaseModel):
    sku: str = Field(..., min_length=1, max_length=128)
    item_name: str = Field(..., min_length=1, max_length=256)
    description: Optional[str] = Field(None, max_length=1000)
    upc: Optional[str] = Field(None, max_length=128)
    mpn: Optional[str] = Field(None, max_length=64)
    category: Optional[str] = Field(None, max_length=128)
    weight_lbs: Optional[Decimal] = Field(None, ge=0, le=99999)
    default_bin_id: Optional[int] = Field(None, gt=0)


class UpdateItemRequest(BaseModel):
    sku: Optional[str] = Field(None, min_length=1, max_length=128)
    item_name: Optional[str] = Field(None, min_length=1, max_length=256)
    description: Optional[str] = Field(None, max_length=1000)
    upc: Optional[str] = Field(None, max_length=128)
    mpn: Optional[str] = Field(None, max_length=64)
    category: Optional[str] = Field(None, max_length=128)
    weight_lbs: Optional[Decimal] = Field(None, ge=0, le=99999)
    default_bin_id: Optional[int] = Field(None, gt=0)
    reorder_point: Optional[int] = Field(None, ge=0)
    reorder_qty: Optional[int] = Field(None, ge=0)
    is_active: Optional[bool] = None
    local_price: Optional[Decimal] = Field(None, gt=0, le=100000000)

    @field_validator("local_price", mode="before")
    @classmethod
    def normalize_local_price(cls, value):
        if value is None:
            raise ValueError("Introdu un preț mai mare decât zero.")
        return value.strip().replace(',', '.') if isinstance(value, str) else value


class CreatePreferredBinRequest(BaseModel):
    item_id: int = Field(..., gt=0)
    bin_id: int = Field(..., gt=0)
    priority: int = Field(1, ge=1, le=100)


class UpdatePreferredBinRequest(BaseModel):
    priority: int = Field(..., ge=1, le=100)

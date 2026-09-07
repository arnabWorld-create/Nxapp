-- Create trigger function to update updated_at on row updates
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at = CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_role
BEFORE UPDATE ON "Role"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_user
BEFORE UPDATE ON "User"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_brand
BEFORE UPDATE ON "Brand"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_product
BEFORE UPDATE ON "Product"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_productvariant
BEFORE UPDATE ON "ProductVariant"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_statement
BEFORE UPDATE ON "Statement"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_import
BEFORE UPDATE ON "Import"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_importmapping
BEFORE UPDATE ON "ImportMapping"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_importrow
BEFORE UPDATE ON "ImportRow"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_statementrow
BEFORE UPDATE ON "StatementRow"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

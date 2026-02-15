export interface CategoryAttribute {
  id: string;
  name: string;
  value_type: string;
  values?: Array<{ id: string; name: string }>;
  tags?: {
    required?: boolean;
    mandatory?: boolean;
  };
  hint?: string;
  allowed_units?: Array<{ id: string; name: string }>;
  path_from_root?: Array<{ id: string; name: string }>;
}

export interface CategoryDetails {
  id: string;
  name: string;
  path_from_root?: Array<{ id: string; name: string }>;
  attributes?: CategoryAttribute[];
}
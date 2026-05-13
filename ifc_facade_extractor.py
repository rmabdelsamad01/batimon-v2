"""
IFC Facade Extractor
====================
Keeps only the building envelope (curtain walls, exterior walls, windows, doors,
roofing, cladding) and strips everything interior to reduce file size.

Requirements:
    pip install ifcopenshell

Usage:
    python ifc_facade_extractor.py input.ifc [output.ifc]

If no output path is given, saves as  input_facade.ifc  next to the original.
"""

import os
import sys
import re

try:
    import ifcopenshell
    import ifcopenshell.util.element as ifc_util
except ImportError:
    sys.exit(
        "ifcopenshell not found.\n"
        "Install it with:  pip install ifcopenshell\n"
        "Or via conda:     conda install -c conda-forge ifcopenshell"
    )


# ── Types that are ALWAYS removed (interior / structural / MEP / misc) ────────
REMOVE_TYPES = {
    # Structural
    "IfcSlab",
    "IfcSlabStandardCase",
    "IfcSlabElementedCase",
    "IfcColumn",
    "IfcColumnStandardCase",
    "IfcBeam",
    "IfcBeamStandardCase",
    "IfcFooting",
    "IfcPile",

    # Vertical circulation
    "IfcStair",
    "IfcStairFlight",
    "IfcRamp",
    "IfcRampFlight",
    "IfcEscalator",
    "IfcLift",

    # Railings / barriers
    "IfcRailing",

    # Spaces / zones / rooms (geometry-less but bloat the file)
    "IfcSpace",
    "IfcZone",
    "IfcSpatialZone",

    # Furnishing & equipment
    "IfcFurnishingElement",
    "IfcFurniture",
    "IfcSystemFurnitureElement",
    "IfcFlowTerminal",
    "IfcFlowSegment",
    "IfcFlowFitting",
    "IfcFlowController",
    "IfcFlowMovingDevice",
    "IfcFlowStorageDevice",
    "IfcFlowTreatmentDevice",
    "IfcDistributionFlowElement",
    "IfcDistributionControlElement",
    "IfcDistributionElement",
    "IfcEnergyConversionDevice",
    "IfcElectricDistributionBoard",
    "IfcElectricAppliance",
    "IfcLightFixture",
    "IfcSanitaryTerminal",
    "IfcMedicalDevice",
    "IfcFireSuppressionTerminal",
    "IfcCommunicationsAppliance",
    "IfcAudioVisualAppliance",

    # Annotations / analysis objects
    "IfcAnnotation",
    "IfcGrid",
    "IfcVirtualElement",
    "IfcProxy",

    # Coverage / ceiling
    "IfcCovering",          # includes ceilings; exterior cladding handled below

    # Generic build elements that are usually interior
    "IfcBuildingElementProxy",
    "IfcDiscreteAccessory",
    "IfcFastener",
    "IfcMechanicalFastener",
    "IfcReinforcingBar",
    "IfcReinforcingMesh",
    "IfcTendon",
}

# ── Types that are ALWAYS kept (envelope) ────────────────────────────────────
KEEP_TYPES = {
    "IfcCurtainWall",
    "IfcCurtainWallType",
    "IfcPlate",                # curtain wall plates / spandrel panels
    "IfcPlateStandardCase",
    "IfcMember",               # mullions / transoms (see IsExternal check below)
    "IfcMemberStandardCase",
    "IfcWindow",
    "IfcWindowStandardCase",
    "IfcDoor",
    "IfcDoorStandardCase",
    "IfcRoof",
    "IfcSite",
    "IfcBuilding",
    "IfcBuildingStorey",
}

# Keywords in object/type name that suggest exterior cladding
EXTERIOR_NAME_HINTS = re.compile(
    r"(facade|cladding|curtain|exterior|external|glazing|envelope|skin"
    r"|parapet|canopy|louvre|louver|sunscreen|brise|shading|balustrade"
    r"|rain.?screen|composite.?panel|aluminium.?panel|glass.?panel)",
    re.IGNORECASE,
)


def is_external(element) -> bool:
    """Return True if the element has IsExternal=True in its Pset_*Common."""
    try:
        psets = ifc_util.get_psets(element)
        for pset in psets.values():
            val = pset.get("IsExternal")
            if val is True or val == "TRUE" or val == 1:
                return True
    except Exception:
        pass
    return False


def name_suggests_exterior(element) -> bool:
    name = getattr(element, "Name", "") or ""
    tag  = getattr(element, "Tag",  "") or ""
    return bool(EXTERIOR_NAME_HINTS.search(name) or EXTERIOR_NAME_HINTS.search(tag))


def should_keep(element) -> bool:
    ifc_type = element.is_a()

    # Always keep site / building / storey hierarchy
    if ifc_type in KEEP_TYPES:
        return True

    # Always remove structural / MEP / interior types
    if ifc_type in REMOVE_TYPES:
        return False

    # IfcWall: keep only exterior ones
    if ifc_type in ("IfcWall", "IfcWallStandardCase", "IfcWallElementedCase"):
        return is_external(element) or name_suggests_exterior(element)

    # IfcMember: keep only exterior (mullions, transoms)
    if ifc_type in ("IfcMember", "IfcMemberStandardCase"):
        return is_external(element) or name_suggests_exterior(element)

    # IfcCovering: keep only exterior (roofing, cladding)
    if ifc_type == "IfcCovering":
        return is_external(element) or name_suggests_exterior(element)

    # Everything else not explicitly listed: keep (type objects, geometry, etc.)
    return True


def collect_elements_to_remove(model) -> set:
    """Walk all IfcProduct instances and collect global IDs to remove."""
    remove_ids = set()
    products = model.by_type("IfcProduct")
    total = len(products)
    print(f"  Scanning {total} products…")

    for i, el in enumerate(products):
        if i % 1000 == 0 and i > 0:
            print(f"    {i}/{total} checked, {len(remove_ids)} marked for removal…")
        if not should_keep(el):
            remove_ids.add(el.GlobalId)

    return remove_ids


def remove_elements(model, remove_ids: set):
    """Delete elements (and their owned geometry) from the model."""
    removed = 0
    # Collect all instances to delete first, then delete (avoid mutation-during-iteration)
    to_delete = [
        el for el in model.by_type("IfcProduct")
        if el.GlobalId in remove_ids
    ]
    for el in to_delete:
        # Remove any decomposition relationships
        try:
            model.remove(el)
            removed += 1
        except Exception:
            pass
    return removed


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    input_path = sys.argv[1]
    if len(sys.argv) >= 3:
        output_path = sys.argv[2]
    else:
        base, ext = os.path.splitext(input_path)
        output_path = base + "_facade" + ext

    if not os.path.isfile(input_path):
        sys.exit(f"File not found: {input_path}")

    original_size = os.path.getsize(input_path) / (1024 * 1024)
    print(f"\n{'='*55}")
    print(f"  IFC Facade Extractor")
    print(f"{'='*55}")
    print(f"  Input : {input_path}  ({original_size:.1f} MB)")
    print(f"  Output: {output_path}")
    print(f"{'='*55}\n")

    print("Step 1/4 — Opening IFC file…")
    model = ifcopenshell.open(input_path)
    print(f"  Schema : {model.schema}")
    print(f"  Total entities: {len(model.by_type('IfcProduct'))}")

    print("\nStep 2/4 — Identifying elements to remove…")
    remove_ids = collect_elements_to_remove(model)
    print(f"  → {len(remove_ids)} elements will be removed")

    print("\nStep 3/4 — Removing elements…")
    removed = remove_elements(model, remove_ids)
    print(f"  → Removed {removed} elements")

    print("\nStep 4/4 — Writing output file…")
    model.write(output_path)

    new_size = os.path.getsize(output_path) / (1024 * 1024)
    reduction = (1 - new_size / original_size) * 100

    print(f"\n{'='*55}")
    print(f"  Done!")
    print(f"  Original : {original_size:.1f} MB")
    print(f"  Facade   : {new_size:.1f} MB")
    print(f"  Reduction: {reduction:.0f}%")
    if new_size <= 50:
        print(f"  ✅  Under 50 MB — ready for Supabase upload!")
    else:
        print(f"  ⚠️   Still over 50 MB.")
        print(f"       Try running the script again on the output file,")
        print(f"       or open the output in your BIM tool and purge unused objects.")
    print(f"{'='*55}\n")


if __name__ == "__main__":
    main()

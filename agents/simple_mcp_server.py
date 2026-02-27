#!/usr/bin/env python3
"""
Simple MCP Server with FastMCP
===============================

Un servidor MCP (Model Context Protocol) usando FastMCP framework.

FUNCIONALIDADES:
---------------
🕒 get_current_time - Obtiene fecha y hora actual
🧮 calculator - Calculadora básica (+, -, *, /)
🎲 random_number - Genera números aleatorios
📊 system_info - Información del sistema
📝 notes - Sistema simple de notas en memoria

INSTALACIÓN:
------------
pip install fastmcp psutil

EJECUCIÓN:
----------
python simple_mcp_server.py
"""

import json
import logging
from datetime import datetime
from typing import Dict, List, Any
import random
import platform
import psutil

# FastMCP import
from fastmcp import FastMCP

# Configurar logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("simple_mcp_server")

# Sistema de notas en memoria
notes_storage: Dict[str, str] = {}
# Crear servidor FastMCP
mcp = FastMCP("Simple MCP Server")

# HERRAMIENTAS - Usar decoradores @mcp.tool()

@mcp.tool()
def get_current_time(timezone: str = "UTC") -> Dict[str, Any]:
    """
    🕒 Obtiene la fecha y hora actual
    
    Args:
        timezone: Zona horaria (por defecto UTC)
    
    Returns:
        Información de fecha y hora formateada
    """
    now = datetime.now()
    return {
        "timestamp": now.isoformat(),
        "formatted": now.strftime("%Y-%m-%d %H:%M:%S"),
        "day_of_week": now.strftime("%A"),
        "timezone": timezone,
        "unix_timestamp": int(now.timestamp())
    }

@mcp.tool()
def calculator(operation: str, a: float, b: float) -> Dict[str, Any]:
    """
    🧮 Calculadora básica
    
    Args:
        operation: Operación (+, -, *, /)
        a: Primer número
        b: Segundo número
    
    Returns:
        Resultado del cálculo
    """
    try:
        operations = {
            "+": lambda x, y: x + y,
            "-": lambda x, y: x - y,
            "*": lambda x, y: x * y,
            "/": lambda x, y: x / y if y != 0 else "Error: División por cero"
        }
        
        if operation not in operations:
            return {"error": f"Operación no soportada: {operation}"}
        
        result = operations[operation](a, b)
        
        return {
            "operation": f"{a} {operation} {b}",
            "result": result,
            "success": True
        }
    
    except Exception as e:
        return {"error": str(e), "success": False}

@mcp.tool()
def random_number(min_val: int = 1, max_val: int = 100, count: int = 1) -> Dict[str, Any]:
    """
    🎲 Genera números aleatorios
    
    Args:
        min_val: Valor mínimo
        max_val: Valor máximo  
        count: Cantidad de números a generar
    
    Returns:
        Lista de números aleatorios generados
    """
    if count > 1000:
        return {"error": "Máximo 1000 números permitidos"}
    
    numbers = [random.randint(min_val, max_val) for _ in range(count)]
    
    return {
        "numbers": numbers,
        "count": len(numbers),
        "range": f"{min_val}-{max_val}",
        "sum": sum(numbers) if count <= 100 else "No calculado (demasiados números)",
        "average": sum(numbers) / len(numbers) if count <= 100 else "No calculado"
    }

@mcp.tool()
def system_info() -> Dict[str, Any]:
    """
    📊 Obtiene información del sistema
    
    Returns:
        Información del sistema operativo y hardware
    """
    try:
        return {
            "platform": platform.system(),
            "platform_version": platform.version(),
            "architecture": platform.machine(),
            "processor": platform.processor(),
            "python_version": platform.python_version(),
            "cpu_count": psutil.cpu_count(),
            "memory_gb": round(psutil.virtual_memory().total / (1024**3), 2),
            "disk_usage": {
                "total_gb": round(psutil.disk_usage('/').total / (1024**3), 2),
                "free_gb": round(psutil.disk_usage('/').free / (1024**3), 2)
            }
        }
    except Exception as e:
        return {"error": f"No se pudo obtener info del sistema: {e}"}

@mcp.tool()
def manage_notes(action: str, note_id: str, content: str = "") -> Dict[str, Any]:
    """
    📝 Sistema simple de notas en memoria
    
    Args:
        action: 'create', 'read', 'update', 'delete', 'list'
        note_id: ID de la nota
        content: Contenido de la nota (para create/update)
    
    Returns:
        Resultado de la operación
    """
    global notes_storage
    
    if action == "create":
        if note_id in notes_storage:
            return {"error": f"La nota '{note_id}' ya existe"}
        notes_storage[note_id] = content
        return {"success": True, "message": f"Nota '{note_id}' creada"}
    
    elif action == "read":
        if note_id not in notes_storage:
            return {"error": f"La nota '{note_id}' no existe"}
        return {"note_id": note_id, "content": notes_storage[note_id]}
    
    elif action == "update":
        if note_id not in notes_storage:
            return {"error": f"La nota '{note_id}' no existe"}
        notes_storage[note_id] = content
        return {"success": True, "message": f"Nota '{note_id}' actualizada"}
    
    elif action == "delete":
        if note_id not in notes_storage:
            return {"error": f"La nota '{note_id}' no existe"}
        del notes_storage[note_id]
        return {"success": True, "message": f"Nota '{note_id}' eliminada"}
    
    elif action == "list":
        return {
            "notes": list(notes_storage.keys()),
            "count": len(notes_storage)
        }
    
    else:
        return {"error": f"Acción no válida: {action}"}

# RECURSOS - Usar decoradores @mcp.resource()

@mcp.resource("file://server-info")
def get_server_info() -> str:
    """🔧 Información sobre este servidor MCP"""
    info = {
        "server": {
            "name": "simple-mcp-server",
            "version": "1.0.0",
            "framework": "FastMCP"
        },
        "uptime": "Running",
        "tools_count": 5,
        "notes_count": len(notes_storage),
        "features": [
            "🕒 Fecha y hora",
            "🧮 Calculadora", 
            "🎲 Números aleatorios",
            "📊 Info del sistema",
            "📝 Sistema de notas"
        ]
    }
    return json.dumps(info, indent=2)

@mcp.resource("file://available-tools")  
def get_available_tools() -> str:
    """🛠️ Lista de herramientas disponibles en este servidor"""
    tools_info = {
        "tools": [
            {
                "name": "get_current_time",
                "description": "🕒 Obtiene fecha y hora actual",
                "parameters": {
                    "timezone": "string (opcional, default: UTC)"
                },
                "example": {"timezone": "America/Mexico_City"}
            },
            {
                "name": "calculator", 
                "description": "🧮 Calculadora básica",
                "parameters": {
                    "operation": "string (+, -, *, /)",
                    "a": "number",
                    "b": "number"
                },
                "example": {"operation": "+", "a": 15, "b": 25}
            },
            {
                "name": "random_number",
                "description": "🎲 Genera números aleatorios", 
                "parameters": {
                    "min_val": "int (opcional, default: 1)",
                    "max_val": "int (opcional, default: 100)", 
                    "count": "int (opcional, default: 1)"
                },
                "example": {"min_val": 1, "max_val": 20, "count": 5}
            },
            {
                "name": "system_info",
                "description": "📊 Información del sistema",
                "parameters": {},
                "example": {}
            },
            {
                "name": "manage_notes",
                "description": "📝 Sistema de notas (CRUD)",
                "parameters": {
                    "action": "string (create/read/update/delete/list)",
                    "note_id": "string",
                    "content": "string (opcional, para create/update)"
                },
                "example": {
                    "action": "create", 
                    "note_id": "meeting", 
                    "content": "Reunión a las 3pm"
                }
            }
        ],
        "total_tools": 5,
        "framework": "FastMCP - Simplified MCP Development"
    }
    return json.dumps(tools_info, indent=2)

# FUNCIONES DE TESTING Y DEMO
def test_tools():
    """Prueba rápida de las herramientas"""
    print("🧪 Probando herramientas MCP...")
    
    # Probar cada herramienta
    tests = [
        ("🕒 Tiempo", lambda: get_current_time()),
        ("🧮 Cálculo", lambda: calculator("+", 15, 25)),
        ("🎲 Random", lambda: random_number(1, 10, 3)),
        ("📊 Sistema", lambda: system_info()),
        ("📝 Nota", lambda: manage_notes("create", "test", "Prueba")),
        ("📋 Lista", lambda: manage_notes("list", "")),
    ]
    
    for name, func in tests:
        try:
            result = func()
            print(f"✅ {name}: OK")
        except Exception as e:
            print(f"❌ {name}: {e}")

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1] == "--test":
        test_tools()
    else:
        print("🚀 Iniciando Simple MCP Server con FastMCP...")
        print("📋 Herramientas: tiempo, calculadora, random, sistema, notas")
        print("🔌 Listo para recibir conexiones MCP...")
        
        # Ejecutar el servidor FastMCP
        mcp.run()
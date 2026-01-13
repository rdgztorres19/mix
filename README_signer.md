# HMAC Request Signer - C++

## Compilar y Ejecutar

### 1. Asegúrate de tener las dependencias instaladas:

```bash
# En macOS con Homebrew:
brew install openssl curl

# En Ubuntu/Debian:
sudo apt-get install libssl-dev libcurl4-openssl-dev

# En CentOS/RHEL:
sudo yum install openssl-devel libcurl-devel
```

### 2. Compilar los programas:

```bash
# Programa completo con cURL (hace requests HTTP)
make signer

# Programa de prueba (solo genera headers)
make test_signer

# Compilar ambos
make all
```

### 3. Ejecutar:

```bash
# Ejecutar el generador de headers (sin hacer request)
./test_signer

# Ejecutar el programa completo (hace request HTTP)
./signer
```

### 4. Limpieza:

```bash
make clean
```

## Compilación Manual

Si no usas make, puedes compilar manualmente:

```bash
# Para signer completo:
g++ -o signer signer.cpp -lssl -lcrypto -lcurl -I/opt/homebrew/include -L/opt/homebrew/lib

# Para test_signer:
g++ -o test_signer test_signer.cpp -lssl -lcrypto -I/opt/homebrew/include -L/opt/homebrew/lib
```

## Descripción

Este programa implementa un sistema de autenticación HMAC-SHA256 para requests HTTP. Genera headers de autenticación basados en:

- API Key
- Secret compartido
- Timestamp
- Método HTTP y path

Los headers generados incluyen:
- X-Service: API key
- X-Timestamp: Timestamp ISO 8601
- X-Signature: Firma HMAC-SHA256 en Base64

## Uso de la clase

```cpp
#include "signer.cpp" // o incluir el header

HmacRequestSigner signer("your-api-key", "your-secret", 60);
std::string headers = signer.signHeaders("GET", "http://example.com/api/endpoint");
```
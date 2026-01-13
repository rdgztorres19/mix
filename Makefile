CXX = g++
CXXFLAGS = -Wall -std=c++11 -I/opt/homebrew/include
LDFLAGS = -L/opt/homebrew/lib
LIBS_SSL = -lssl -lcrypto
LIBS_CURL = -lcurl
LIBS_FULL = $(LIBS_SSL) $(LIBS_CURL)

# Detectar si estamos en Linux y ajustar paths
UNAME_S := $(shell uname -s)
ifeq ($(UNAME_S),Linux)
    CXXFLAGS = -Wall -std=c++11
    LDFLAGS = 
endif

.PHONY: all clean

all: signer test_signer

signer: signer.cpp
	$(CXX) $(CXXFLAGS) $(LDFLAGS) -o signer signer.cpp $(LIBS_FULL)

test_signer: test_signer.cpp
	$(CXX) $(CXXFLAGS) $(LDFLAGS) -o test_signer test_signer.cpp $(LIBS_SSL)

clean:
	rm -f signer test_signer

install_deps_mac:
	brew install openssl curl

install_deps_ubuntu:
	sudo apt-get update && sudo apt-get install -y libssl-dev libcurl4-openssl-dev build-essential

test: test_signer signer
	@echo "🧪 Ejecutando test de generación de headers..."
	./test_signer
	@echo "\n🧪 Intentando request completo..."
	./signer
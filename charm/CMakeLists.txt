cmake_minimum_required(VERSION 3.16)
# The version is the commit a build was made from, which is what an update
# compares (main/ota.c); a build made outside the workflow says so.
if(DEFINED ENV{CHARM_VERSION})
    set(PROJECT_VER $ENV{CHARM_VERSION})
else()
    set(PROJECT_VER "local")
endif()
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(charm)
